import { useEffect, useRef, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { MessageSquare, Send, Pencil, Undo2, ImagePlus } from "lucide-react";
import { uid } from "../lib/api";
import { inkFor, readableInk, SKETCH_PAPER } from "../lib/sketch-ink";
import { collaborationUrl } from "../lib/collaboration-url";
type Note = { id: string; author: string; body: string; at: string };
type Stroke = {
  id: string;
  author: string;
  color: string;
  points: [number, number][];
};
export default function SharedNotes({
  id,
  token,
  actor,
  readOnly,
  onReference,
}: {
  id: string;
  token: string;
  actor: string;
  readOnly: boolean;
  onReference?: (image: string) => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]),
    [text, setText] = useState(""),
    [status, setStatus] = useState("Connecting"),
    [array, setArray] = useState<Y.Array<Note> | null>(null),
    [mode, setMode] = useState<"notes" | "sketch">("notes");
  const [strokes, setStrokes] = useState<Stroke[]>([]),
    [drawingArray, setDrawingArray] = useState<Y.Array<Stroke> | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    current = useRef<[number, number][]>([]),
    strokeRef = useRef<Stroke[]>([]);
  const color = inkFor(actor);
  useEffect(() => {
    const doc = new Y.Doc(),
      a = doc.getArray<Note>("notes"),
      sketch = doc.getArray<Stroke>("sketch-strokes");
    const update = () => setNotes(a.toArray()),
      updateSketch = () => {
        strokeRef.current = sketch.toArray();
        setStrokes(strokeRef.current);
      };
    a.observe(update);
    sketch.observe(updateSketch);
    setArray(a);
    setDrawingArray(sketch);
    const p = new HocuspocusProvider({
      url: collaborationUrl(location.href, import.meta.env.VITE_COLLAB_PATH),
      name: id,
      document: doc,
      token,
      onStatus: ({ status: s }) =>
        setStatus(s === "connected" ? "Connected" : "Reconnecting"),
      onAuthenticationFailed: () => setStatus("Could not connect"),
    });
    return () => {
      a.unobserve(update);
      sketch.unobserve(updateSketch);
      p.destroy();
      doc.destroy();
      setArray(null);
      setDrawingArray(null);
    };
  }, [id, token]);
  function draw() {
    const c = canvas.current?.getContext("2d");
    if (!c) return;
    c.fillStyle = SKETCH_PAPER;
    c.fillRect(0, 0, 640, 420);
    const all = [
      ...strokeRef.current,
      ...(current.current.length
        ? [{ id: "pending", author: actor, color, points: current.current }]
        : []),
    ];
    for (const stroke of all) {
      if (!stroke.points.length) continue;
      c.strokeStyle = readableInk(stroke.color);
      c.lineWidth = 3;
      c.lineCap = "round";
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(...stroke.points[0]);
      for (const pt of stroke.points.slice(1)) c.lineTo(...pt);
      if (stroke.points.length === 1)
        c.lineTo(stroke.points[0][0] + 0.1, stroke.points[0][1] + 0.1);
      c.stroke();
    }
  }
  useEffect(draw, [strokes, mode]);
  function point(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * 640) / r.width,
      ((e.clientY - r.top) * 420) / r.height,
    ];
  }
  function finish() {
    if (current.current.length && drawingArray && !readOnly) {
      drawingArray.push([
        { id: uid(), author: actor, color, points: [...current.current] },
      ]);
      current.current = [];
      draw();
    }
  }
  function send() {
    if (!text.trim() || !array || readOnly) return;
    array.push([
      {
        id: uid(),
        author: actor,
        body: text.trim(),
        at: new Date().toISOString(),
      },
    ]);
    setText("");
  }
  function undo() {
    if (!drawingArray || readOnly) return;
    const items = drawingArray.toArray();
    for (let i = items.length - 1; i >= 0; i--)
      if (items[i].author === actor) {
        drawingArray.delete(i, 1);
        return;
      }
  }
  return (
    <section className="notes-panel">
      <div className="shared-tabs" role="tablist" aria-label="Shared workspace">
        <button
          role="tab"
          aria-selected={mode === "notes"}
          className={mode === "notes" ? "selected" : ""}
          onClick={() => setMode("notes")}
        >
          <MessageSquare size={16} /> Notes
        </button>
        <button
          role="tab"
          aria-selected={mode === "sketch"}
          className={mode === "sketch" ? "selected" : ""}
          onClick={() => setMode("sketch")}
        >
          <Pencil size={16} /> Sketch
        </button>
        <span className="subtle">{status}</span>
      </div>
      {mode === "notes" ? (
        <>
          {notes.length === 0 ? (
            <p className="subtle">
              Leave a measurement or a question for the next person.
            </p>
          ) : (
            <div className="notes-list">
              {notes.map((n) => (
                <article key={n.id}>
                  <strong>{n.author}</strong>
                  <p>{n.body}</p>
                </article>
              ))}
            </div>
          )}
          {!readOnly && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <label className="sr-only" htmlFor="shared-note">
                Add a shared note
              </label>
              <textarea
                id="shared-note"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Add a note…"
                rows={2}
                maxLength={1000}
              />
              <button
                className="button small"
                disabled={!text.trim() || status !== "Connected"}
              >
                <Send size={14} /> Add note
              </button>
            </form>
          )}
        </>
      ) : (
        <div className="shared-sketch">
          <p>
            Draw together. Add measurements in a note, then use the sketch to
            explain a design change.
          </p>
          <canvas
            data-testid="shared-sketch"
            ref={canvas}
            width={640}
            height={420}
            aria-label="Shared drawing canvas"
            onPointerDown={(e) => {
              if (readOnly || status !== "Connected") return;
              e.currentTarget.setPointerCapture(e.pointerId);
              current.current = [point(e)];
              draw();
            }}
            onPointerMove={(e) => {
              if (!current.current.length) return;
              current.current.push(point(e));
              draw();
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
          />
          <span className="subtle">{strokes.length} shared strokes</span>
          {!readOnly && (
            <div className="shared-sketch-actions">
              <button
                className="button small"
                onClick={undo}
                disabled={!strokes.some((s) => s.author === actor)}
              >
                <Undo2 size={15} /> Undo my stroke
              </button>
              <button
                className="button small"
                onClick={() => {
                  if (canvas.current)
                    onReference?.(canvas.current.toDataURL("image/png"));
                }}
                disabled={!strokes.length}
              >
                <ImagePlus size={15} /> Use as reference
              </button>
            </div>
          )}
          <div className="sketch-authors">
            {Array.from(new Set(strokes.map((s) => s.author))).map((author) => (
              <span key={author}>
                <i
                  style={{
                    background: strokes.find((s) => s.author === author)?.color,
                  }}
                />
                {author}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
