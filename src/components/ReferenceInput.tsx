import { useEffect, useRef, useState } from "react";
import { X, ImagePlus, Mic, Pencil, Check, Trash2 } from "lucide-react";
import { colors } from "../lib/tokens";
import { useDialog } from "../lib/useDialog";
type Recognition = any;
export function VoiceButton({
  onText,
  onError,
}: {
  onText: (text: string) => void;
  onError: (error: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const ref = useRef<Recognition>(null);
  useEffect(() => () => ref.current?.abort(), []);
  function listen() {
    const C =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!C) {
      onError(
        "Voice input is not supported in this browser. You can type the same instruction.",
      );
      return;
    }
    if (listening) {
      ref.current?.stop();
      return;
    }
    const r = new C();
    r.lang = "en-US";
    r.interimResults = false;
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onerror = () => {
      setListening(false);
      onError(
        "Microphone access was unavailable. Check your browser permission or type your instruction.",
      );
    };
    r.onresult = (e: any) => onText(e.results[0][0].transcript);
    ref.current = r;
    r.start();
  }
  return (
    <button
      type="button"
      className={"button icon-only " + (listening ? "recording" : "")}
      onClick={listen}
      aria-label={listening ? "Stop listening" : "Speak an instruction"}
      title={listening ? "Stop listening" : "Speak an instruction"}
    >
      <Mic size={17} />
    </button>
  );
}
export default function ReferenceInput({
  image,
  onImage,
  onError,
}: {
  image: string;
  onImage: (image: string) => void;
  onError: (error: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [sketch, setSketch] = useState(false),
    [caption, setCaption] = useState(
      "Reference attached. Include a known measurement for accurate sizing.",
    );
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useDialog(sketch, () => setSketch(false));
  useEffect(() => {
    if (sketch && canvas.current) {
      const c = canvas.current.getContext("2d")!;
      c.fillStyle = colors.white;
      c.fillRect(0, 0, 640, 420);
      c.strokeStyle = colors.text;
      c.lineWidth = 3;
      c.lineCap = "round";
    }
  }, [sketch]);
  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * 640) / r.width,
      ((e.clientY - r.top) * 420) / r.height,
    ];
  }
  async function read(file?: File) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      onError("Choose a reference smaller than 25 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    let video: HTMLVideoElement | undefined;
    try {
      let source: CanvasImageSource, w: number, h: number;
      if (file.type.startsWith("video/")) {
        video = document.createElement("video");
        const v = video;
        v.muted = true;
        v.preload = "auto";
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(
                  "The video took too long to open. Try a shorter MP4.",
                ),
              ),
            10000,
          );
          v.onloadeddata = () => {
            clearTimeout(timer);
            resolve();
          };
          v.onerror = () => {
            clearTimeout(timer);
            reject(new Error("Video could not be opened."));
          };
          v.src = url;
          v.load();
        });
        const seekTime = Math.min(
          0.5,
          Number.isFinite(v.duration) ? v.duration / 2 : 0.5,
        );
        if (seekTime > 0) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "A video frame could not be extracted. Try a photo.",
                  ),
                ),
              5000,
            );
            v.onseeked = () => {
              clearTimeout(timer);
              resolve();
            };
            v.currentTime = seekTime;
          });
        }
        source = v;
        w = v.videoWidth;
        h = v.videoHeight;
        setCaption(
          "One frame from your video is attached. Describe the motion you want in your instruction.",
        );
      } else {
        const i = new Image();
        i.src = url;
        await Promise.race([
          i.decode(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("The image took too long to open.")),
              10000,
            ),
          ),
        ]);
        source = i;
        w = i.width;
        h = i.height;
        setCaption(
          "Reference attached. Include a known measurement for accurate sizing.",
        );
      }
      if (!w || !h) throw new Error("This reference has no readable image.");
      const c = document.createElement("canvas"),
        scale = Math.min(1, 1000 / Math.max(w, h));
      c.width = w * scale;
      c.height = h * scale;
      c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
      onImage(c.toDataURL("image/jpeg", 0.8));
    } catch (e) {
      onError(
        (e as Error).message ||
          "That reference could not be opened. Try a PNG or JPEG.",
      );
    } finally {
      video?.pause();
      video?.removeAttribute("src");
      video?.load();
      URL.revokeObjectURL(url);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="image/*,video/mp4,video/webm"
        aria-label="Upload a photo, sketch or video reference"
        onChange={(e) => void read(e.target.files?.[0])}
      />
      <button
        type="button"
        className="button icon-only"
        onClick={() => fileRef.current?.click()}
        aria-label="Attach a photo or video"
        title="Attach a photo or video"
      >
        <ImagePlus size={17} />
      </button>
      <button
        type="button"
        className="button icon-only"
        onClick={() => setSketch(true)}
        aria-label="Draw a sketch"
        title="Draw a sketch"
      >
        <Pencil size={17} />
      </button>
      {image && (
        <div className="reference-preview">
          <img src={image} alt="Your design reference" />
          <button
            className="button icon-only"
            aria-label="Remove reference"
            onClick={() => onImage("")}
          >
            <X size={15} />
          </button>
          <p>{caption}</p>
        </div>
      )}
      {sketch && (
        <div className="modal-backdrop" onClick={() => setSketch(false)}>
          <section
            className="modal sketch-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sketch-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <h2 id="sketch-title">Sketch your idea</h2>
              <button
                className="button icon-only"
                aria-label="Close sketch"
                onClick={() => setSketch(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              Draw the shape or mark the detail you want to change. Include
              dimensions in your instruction.
            </p>
            <canvas
              ref={canvas}
              width={640}
              height={420}
              onPointerDown={(e) => {
                drawing.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                const p = point(e),
                  c = e.currentTarget.getContext("2d")!;
                c.beginPath();
                c.moveTo(p[0], p[1]);
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                const p = point(e),
                  c = e.currentTarget.getContext("2d")!;
                c.lineTo(p[0], p[1]);
                c.stroke();
              }}
              onPointerUp={() => {
                drawing.current = false;
              }}
              onPointerCancel={() => {
                drawing.current = false;
              }}
            />
            <div className="modal-actions">
              <button
                className="button"
                onClick={() => {
                  const c = canvas.current!.getContext("2d")!;
                  c.fillStyle = colors.white;
                  c.fillRect(0, 0, 640, 420);
                }}
              >
                <Trash2 size={16} /> Clear
              </button>
              <button
                className="button primary"
                onClick={() => {
                  onImage(canvas.current!.toDataURL("image/png"));
                  setCaption(
                    "Your sketch is attached. Include dimensions in your instruction.",
                  );
                  setSketch(false);
                }}
              >
                <Check size={16} /> Use sketch
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
