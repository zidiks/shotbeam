"""Shotbeam's Python worker: the local models the engine calls one command at a time.

Each command writes its result to --out (JSON or audio) and reports progress on stdout as
`@@progress <0..1> <message>` lines. Text comes in files, never as arguments (Windows encodings).
"""

import argparse
import glob
import json
import os
import site
import sys


def progress(fraction, message=""):
    print(f"@@progress {max(0.0, min(1.0, fraction)):.4f} {message}", flush=True)


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def add_cuda_dlls():
    """CUDA libraries installed from pip (nvidia-cublas-cu12, nvidia-cudnn-cu12) on Windows."""
    if os.name != "nt":
        return
    for base in site.getsitepackages():
        for d in glob.glob(os.path.join(base, "nvidia", "*", "bin")):
            os.add_dll_directory(d)
            os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]


def read_wav_16k(path):
    """The engine's 16 kHz mono PCM WAV as float32 samples (no PyAV, whose API shifts)."""
    import wave

    import numpy as np

    with wave.open(path, "rb") as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError("expected 16 kHz mono 16-bit WAV")
        data = w.readframes(w.getnframes())
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0


def cmd_transcribe(a):
    add_cuda_dlls()
    from faster_whisper import WhisperModel

    audio = read_wav_16k(a.audio)
    attempts = [("cuda", "int8"), ("cpu", "int8")] if a.device == "auto" else [(a.device, "int8")]
    last_error = None
    for device, compute in attempts:
        try:
            progress(0.01, f"loading {a.model} on {device}")
            model = WhisperModel(a.model, device=device, compute_type=compute, download_root=a.models)
            segments, info = model.transcribe(
                audio,
                language=a.language or None,
                word_timestamps=True,
                vad_filter=True,
                beam_size=5,
            )
            duration = info.duration or 1.0
            out = []
            # Segments come lazily: a CUDA problem shows up here, not when loading.
            for s in segments:
                words = [
                    {"start": round(w.start, 3), "end": round(w.end, 3), "text": w.word.strip()}
                    for w in (s.words or [])
                ]
                out.append(
                    {"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip(), "words": words}
                )
                progress(s.end / duration, device)
            result = {
                "language": info.language,
                "text": " ".join(x["text"] for x in out).strip(),
                "segments": out,
                "device": device,
            }
            with open(a.out, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False)
            return
        except Exception as e:  # noqa: BLE001 - fall back to the next device
            last_error = e
            print(f"transcribe on {device} failed: {e}", file=sys.stderr, flush=True)
    raise last_error


def cmd_beats(a):
    import librosa
    import numpy as np

    progress(0.1, "loading")
    y, sr = librosa.load(a.audio, sr=22050, mono=True)
    progress(0.5, "tracking beats")
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    result = {"bpm": round(float(np.atleast_1d(tempo)[0]), 2), "beats": [round(float(b), 3) for b in beats]}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(result, f)


def cmd_kokoro(a):
    import soundfile as sf
    from kokoro_onnx import Kokoro

    progress(0.1, "loading kokoro")
    k = Kokoro(os.path.join(a.models, "kokoro-v1.0.onnx"), os.path.join(a.models, "voices-v1.0.bin"))
    progress(0.3, "speaking")
    samples, rate = k.create(read_text(a.text_file), voice=a.voice, speed=a.speed, lang=a.lang)
    sf.write(a.out, samples, rate)


def cmd_kokoro_voices(a):
    from kokoro_onnx import Kokoro

    k = Kokoro(os.path.join(a.models, "kokoro-v1.0.onnx"), os.path.join(a.models, "voices-v1.0.bin"))
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(sorted(k.get_voices()), f)


def cmd_chatterbox(a):
    add_cuda_dlls()
    import torch
    import torchaudio
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    progress(0.05, f"loading chatterbox on {device}")
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    progress(0.3, "speaking")
    wav = model.generate(
        read_text(a.text_file),
        language_id=a.lang,
        audio_prompt_path=a.ref or None,
        exaggeration=a.exaggeration,
        cfg_weight=a.cfg,
    )
    torchaudio.save(a.out, wav, model.sr)


def cmd_check(a):
    """Which features import, as JSON."""
    found = {}
    for name, module in [
        ("whisper", "faster_whisper"),
        ("ytdlp", "yt_dlp"),
        ("beats", "librosa"),
        ("kokoro", "kokoro_onnx"),
        ("chatterbox", "chatterbox"),
    ]:
        try:
            __import__(module)
            found[name] = True
        except Exception:  # noqa: BLE001
            found[name] = False
    try:
        add_cuda_dlls()
        import ctranslate2

        found["cuda"] = ctranslate2.get_cuda_device_count() > 0
    except Exception:  # noqa: BLE001
        found["cuda"] = False
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(found, f)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("transcribe")
    t.add_argument("--audio", required=True)
    t.add_argument("--out", required=True)
    t.add_argument("--model", default="small")
    t.add_argument("--models", required=True)
    t.add_argument("--device", default="auto")
    t.add_argument("--language", default="")

    b = sub.add_parser("beats")
    b.add_argument("--audio", required=True)
    b.add_argument("--out", required=True)

    k = sub.add_parser("kokoro")
    k.add_argument("--text-file", required=True)
    k.add_argument("--out", required=True)
    k.add_argument("--models", required=True)
    k.add_argument("--voice", default="af_heart")
    k.add_argument("--lang", default="en-us")
    k.add_argument("--speed", type=float, default=1.0)

    kv = sub.add_parser("kokoro-voices")
    kv.add_argument("--out", required=True)
    kv.add_argument("--models", required=True)

    c = sub.add_parser("chatterbox")
    c.add_argument("--text-file", required=True)
    c.add_argument("--out", required=True)
    c.add_argument("--lang", default="ru")
    c.add_argument("--ref", default="")
    c.add_argument("--exaggeration", type=float, default=0.5)
    c.add_argument("--cfg", type=float, default=0.5)

    ch = sub.add_parser("check")
    ch.add_argument("--out", required=True)

    a = p.parse_args()
    {
        "transcribe": cmd_transcribe,
        "beats": cmd_beats,
        "kokoro": cmd_kokoro,
        "kokoro-voices": cmd_kokoro_voices,
        "chatterbox": cmd_chatterbox,
        "check": cmd_check,
    }[a.cmd](a)


if __name__ == "__main__":
    main()
