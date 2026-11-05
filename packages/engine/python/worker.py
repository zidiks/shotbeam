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


KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Krumhansl-Schmuckler key profiles.
MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


def estimate_key(chroma):
    import numpy as np

    best = (-2.0, "")
    for i in range(12):
        for profile, mode in ((MAJOR, "major"), (MINOR, "minor")):
            r = float(np.corrcoef(chroma, np.roll(profile, i))[0, 1])
            if r > best[0]:
                best = (r, f"{KEY_NAMES[i]} {mode}")
    return best[1]


def cmd_beats(a):
    import librosa
    import numpy as np

    progress(0.1, "loading")
    y, sr = librosa.load(a.audio, sr=22050, mono=True)
    hop = 512
    progress(0.4, "tracking beats")
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=hop, units="time")
    progress(0.6, "describing")
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop)
    duration = len(y) / sr
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop).mean(axis=1)
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    per_second = max(1, int(round(sr / hop)))
    seconds = [float(rms[i : i + per_second].mean()) for i in range(0, len(rms), per_second)]
    peak = max(seconds) if seconds and max(seconds) > 0 else 1.0
    result = {
        "bpm": round(float(np.atleast_1d(tempo)[0]), 2),
        "beats": [round(float(b), 3) for b in beats],
        "key": estimate_key(chroma),
        "brightness": round(float(centroid.mean())),
        "density": round(len(onsets) / max(duration, 1e-6), 2),
        "curve": [round(v / peak, 2) for v in seconds],
    }
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


def cmd_musicgen(a):
    add_cuda_dlls()
    import soundfile as sf
    import torch
    from transformers import AutoProcessor, MusicgenForConditionalGeneration

    device = "cuda" if torch.cuda.is_available() else "cpu"
    progress(0.05, f"loading {a.model} on {device}")
    processor = AutoProcessor.from_pretrained(a.model)
    model = MusicgenForConditionalGeneration.from_pretrained(a.model).to(device)
    inputs = processor(text=[read_text(a.text_file)], padding=True, return_tensors="pt").to(device)
    rate = model.config.audio_encoder.sampling_rate
    frame_rate = getattr(model.config.audio_encoder, "frame_rate", 50) or 50
    # About 30 s is the most MusicGen makes in one go.
    tokens = min(1503, int(a.seconds * frame_rate))
    progress(0.3, f"composing {a.seconds:.0f} s")
    with torch.no_grad():
        audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=tokens)
    progress(0.95, "saving")
    sf.write(a.out, audio[0, 0].float().cpu().numpy(), rate)


def cmd_check(a):
    """Which features import, as JSON."""
    found = {}
    for name, module in [
        ("whisper", "faster_whisper"),
        ("ytdlp", "yt_dlp"),
        ("beats", "librosa"),
        ("kokoro", "kokoro_onnx"),
        ("chatterbox", "chatterbox"),
        ("musicgen", "transformers"),
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

    mg = sub.add_parser("musicgen")
    mg.add_argument("--text-file", required=True)
    mg.add_argument("--out", required=True)
    mg.add_argument("--model", default="facebook/musicgen-small")
    mg.add_argument("--seconds", type=float, default=15)

    ch = sub.add_parser("check")
    ch.add_argument("--out", required=True)

    a = p.parse_args()
    {
        "transcribe": cmd_transcribe,
        "beats": cmd_beats,
        "kokoro": cmd_kokoro,
        "kokoro-voices": cmd_kokoro_voices,
        "chatterbox": cmd_chatterbox,
        "musicgen": cmd_musicgen,
        "check": cmd_check,
    }[a.cmd](a)


if __name__ == "__main__":
    main()
