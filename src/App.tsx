import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Box,
  ChevronRight,
  FolderOpen,
  Layers3,
  Plus,
  Search,
  SlidersHorizontal,
  Play,
  Pause,
  RotateCcw,
  Download,
  Check,
  Loader2,
} from "lucide-react";
import type {
  Design,
  Part,
  ProductDefinition,
  ProductKind,
  Snapshot,
} from "./shared/types";
import { CATALOG } from "./shared/catalog";
import { createDesign, deriveDesign } from "./shared/engine";
import ModelCanvas from "./components/ModelCanvas";
import Studio from "./Studio";
import Development from "./Development";
import ClipRender from "./ClipRender";
import { deskArmParts } from "./shared/desk-arm";
import { droneParts } from "./shared/drone";
import RequestBox from "./components/RequestBox";
import ViewInRoom from "./ViewInRoom";
import Landing from "./components/Landing";
import { create, pathFor, recent, type Recent } from "./lib/api";
import { colors } from "./lib/tokens";
export type Navigate = (path: string) => void;
/** Working designs that start as your own editable copy straight away, on /new and /browse alike. */
const STARTERS = [
  { key: "drone", name: "Camera drone", label: "Start with a camera drone", testId: "start-drone", category: "Motion & photography", group: "Motion",
    line: "A 250 mm quadcopter with carbon arms, a rounded body and a camera on a gimbal.", image: "/previews/drone.png", parts: droneParts },
  { key: "arm", name: "Articulated camera arm", label: "Start with an articulated camera arm", testId: "start-arm", category: "Desk & studio", group: "Desk & studio",
    line: "A desk-clamped arm that holds a phone or a small camera.", image: "/previews/arm.png", parts: deskArmParts },
] as const;
export function preview(kind: ProductKind): Snapshot {
  const design: Design = {
    ...createDesign(kind),
    id: "preview-" + kind,
    createdAt: "",
    updatedAt: "",
  };
  return { design, derived: deriveDesign(design), history: [] };
}
export function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="brand"
      onClick={onClick}
      aria-label="MakeAnything home"
    >
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <circle cx="5" cy="5" r="3.2" /><circle cx="19" cy="5" r="3.2" /><circle cx="5" cy="19" r="3.2" /><circle cx="19" cy="19" r="3.2" />
          <path d="M7.3 7.3 10 10M16.7 7.3 14 10M7.3 16.7 10 14M16.7 16.7 14 14" /><rect x="9.6" y="9.6" width="4.8" height="4.8" rx="1.2" />
        </svg>
      </span>
      <span>MakeAnything</span>
    </button>
  );
}
export default function App() {
  const [path, setPath] = useState(location.pathname),
    [navTick, setNavTick] = useState(0);
  const navigate = (next: string) => {
    history.pushState(null, "", next);
    setPath(location.pathname);
    setNavTick((n) => n + 1);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const pop = () => {
      setPath(location.pathname);
      setNavTick((n) => n + 1);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  if (path === "/render-clip") return <ClipRender />;
  if (path.startsWith("/view/")) return <ViewInRoom key={path} id={decodeURIComponent(path.split("/")[2])} />;
  if (path.startsWith("/develop/")) return <Development key={path + navTick} id={decodeURIComponent(path.split("/")[2])} navigate={navigate} />;
  if (path.startsWith("/studio/"))
    return (
      <Studio
        key={path + navTick}
        id={decodeURIComponent(path.split("/")[2])}
        navigate={navigate}
      />
    );
  const kind = path.startsWith("/designs/")
    ? (path.split("/")[2] as ProductKind)
    : undefined;
  return (
    <>
      <header className={"site-header" + (path === "/" ? " landing-header" : "")}>
        <Brand onClick={() => navigate("/")} />
        <nav aria-label="Main navigation">
          <button
            className={path === "/browse" ? "active" : ""}
            onClick={() => navigate("/browse")}
          >
            Browse
          </button>
          <button
            className={path === "/work" ? "active" : ""}
            onClick={() => navigate("/work")}
          >
            Your work
          </button>
        </nav>
        <button
          className="button primary small"
          onClick={() => navigate("/new")}
        >
          <Plus size={16} /> New design
        </button>
      </header>
      {kind && CATALOG.some((p) => p.kind === kind) ? (
        <Listing kind={kind} navigate={navigate} />
      ) : path === "/new" ? (
        <NewDesign navigate={navigate} />
      ) : path === "/work" ? (
        <Work navigate={navigate} />
      ) : path === "/judge" ? (
        <Judge navigate={navigate} />
      ) : path === "/browse" ? (
        <Catalog navigate={navigate} />
      ) : (
        <Landing navigate={navigate} />
      )}
      <footer className="site-footer">
        <Brand onClick={() => navigate("/")} />
        <span>Change a working design, check it, then build it yourself.</span>
        <button
          className="button quiet small"
          onClick={() => navigate("/judge")}
        >
          Explore the workflow <ChevronRight size={15} />
        </button>
      </footer>
    </>
  );
}
function Catalog({ navigate }: { navigate: Navigate }) {
  const [filter, setFilter] = useState("All designs"),
    [query, setQuery] = useState("");
  const categories = ["All designs", "Motion", "Desk & studio", "Growing"];
  const group = (kind: ProductKind) =>
    kind === "planter"
      ? "Growing"
      : ["turntable", "slider", "conveyor"].includes(kind)
        ? "Motion"
        : "Desk & studio";
  const matches = (category: string, text: string) =>
    (filter === "All designs" || category === filter) && text.toLowerCase().includes(query.toLowerCase());
  const shown = CATALOG.filter(
    (p) => p.kind !== "custom" && matches(group(p.kind), p.name + " " + p.description),
  );
  // The camera drone and the camera arm come first; each opens as your own copy, as on /new.
  const starters = STARTERS.filter((s) => matches(s.group, s.name + " " + s.line));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function start(starter: (typeof STARTERS)[number]) {
    setBusy(true);
    setError("");
    try {
      const r = await create("custom", starter.name, starter.parts());
      navigate(pathFor(r.snapshot.design.id, r.access.editorToken));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="catalog-page">
      <header className="browse-heading">
        <h1 id="collection-heading">Find your starting point.</h1>
        <p>Try a mechanism, make a copy, and change it together.</p>
      </header>
      <section className="collection" aria-labelledby="collection-heading">
        <div className="collection-toolbar">
          <div
            className="filter-tabs"
            role="group"
            aria-label="Design categories"
          >
            {categories.map((c) => (
              <button
                key={c}
                className={filter === c ? "selected" : ""}
                onClick={() => setFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="search-field">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a design"
              aria-label="Find a design"
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="product-grid">
          {starters.map((starter) => (
            <StarterCard key={starter.key} starter={starter} busy={busy} onStart={() => void start(starter)} />
          ))}
          {shown.map((product, i) => (
            <ProductCard
              key={product.kind}
              product={product}
              index={i}
              navigate={navigate}
            />
          ))}
        </div>
        {shown.length + starters.length === 0 && (
          <div className="empty">
            <Search size={26} />
            <h3>No designs match this search.</h3>
            <button
              className="button"
              onClick={() => {
                setQuery("");
                setFilter("All designs");
              }}
            >
              Show all designs
            </button>
          </div>
        )}
      </section>
      <section className="workflow-strip">
        <div>
          <Box size={24} />
          <strong>Want something else?</strong>
        </div>
        <p>
          Describe it, and the assistant starts from the closest working design.
        </p>
        <button className="button primary" onClick={() => navigate("/new")}>
          Describe what you want <ChevronRight size={16} />
        </button>
      </section>
    </main>
  );
}
function StarterCard({
  starter,
  busy,
  onStart,
}: {
  starter: (typeof STARTERS)[number];
  busy: boolean;
  onStart: () => void;
}) {
  const parts = useMemo(() => {
    const design: Design = { ...createDesign("custom", starter.name, starter.parts()), id: "preview-" + starter.key, createdAt: "", updatedAt: "" };
    return deriveDesign(design).parts.filter((part) => part.role !== "reference");
  }, [starter]);
  return (
    <article className="product-card" data-testid={"product-" + starter.key}>
      <button
        className="product-preview"
        aria-label={starter.label}
        data-testid={"browse-" + starter.testId}
        disabled={busy}
        onClick={onStart}
      >
        <ModelCanvas compact parts={parts} ariaLabel={starter.name + " 3D preview"} />
        <span className="preview-action">
          Make it yours <ChevronRight size={16} />
        </span>
      </button>
      <div className="product-meta">
        <div>
          <span className="eyebrow">{starter.category}</span>
          <h3>{starter.name}</h3>
          <p>{starter.line}</p>
        </div>
        <button
          className="button icon-only"
          aria-label={"Open " + starter.name}
          disabled={busy}
          onClick={onStart}
        >
          {busy ? <Loader2 size={20} className="spin" /> : <ChevronRight size={20} />}
        </button>
      </div>
    </article>
  );
}
function ProductCard({
  product,
  index,
  navigate,
}: {
  product: ProductDefinition;
  index: number;
  navigate: Navigate;
}) {
  const snapshot = useMemo(() => preview(product.kind), [product.kind]);
  return (
    <article className="product-card" data-testid={"product-" + product.kind}>
      <button
        className="product-preview"
        aria-label={"Explore " + product.name}
        onClick={() => navigate("/designs/" + product.kind)}
      >
        <ModelCanvas
          compact
          parts={snapshot.derived.parts.filter((part) => part.role !== "reference")}
          ariaLabel={product.name + " 3D preview"}
        />
        <span className="preview-action">
          Explore design <ChevronRight size={16} />
        </span>
      </button>
      <div className="product-meta">
        <div>
          <span className="eyebrow">{product.category}</span>
          <h3>{product.name}</h3>
          <p>{product.description}</p>
        </div>
        <button
          className="button icon-only"
          aria-label={"Open " + product.name}
          onClick={() => navigate("/designs/" + product.kind)}
        >
          <ChevronRight size={20} />
        </button>
      </div>

    </article>
  );
}
function Listing({
  kind,
  navigate,
}: {
  kind: ProductKind;
  navigate: Navigate;
}) {
  const p = CATALOG.find((x) => x.kind === kind)!;
  const snapshot = useMemo(() => preview(kind), [kind]);
  const [playing, setPlaying] = useState(false),
    [exploded, setExploded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reset, setReset] = useState(0);
  async function customize() {
    setBusy(true);
    setError("");
    try {
      const r = await create(kind);
      navigate(pathFor(r.snapshot.design.id, r.access.editorToken));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const stage = (
    <div className="listing-stage">
      <div className="stage-label">
        <span className="eyebrow">Try it before you make it</span>
        <button
          className="button icon-only"
          onClick={() => setReset((v) => v + 1)}
          aria-label="Reset camera"
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <ModelCanvas
        parts={snapshot.derived.parts}
        playing={playing}
        exploded={exploded}
        reset={reset}
      />
      <div className="viewer-toolbar">
        <button
          className={"button " + (playing ? "primary" : "")}
          onClick={() => setPlaying(!playing)}
          disabled={!snapshot.derived.parts.some(part => part.motion)}
          title={kind === "lamp" ? "Make a copy, then change Joint angle in Dimensions." : undefined}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}{" "}
          {playing ? "Pause" : snapshot.derived.parts.some(part => part.motion) ? "Try the mechanism" : "Static pose"}
        </button>
        <button
          className={"button " + (exploded ? "selected" : "")}
          onClick={() => setExploded(!exploded)}
        >
          <Layers3 size={16} />
          {exploded ? "Assemble" : "Explode view"}
        </button>
        <span>Drag to rotate / Scroll to zoom</span>
      </div>
    </div>
  );
  const heading = (
    <>
      <span className="eyebrow">{p.category}</span>
      <h1>{p.name}</h1>
    </>
  );
  const details = (
    <>
      <p className="lead">{p.story || p.description}</p>
      <div className="listing-specs">
        {p.parameters.slice(0, 3).map((s) => (
          <div key={s.key}>
            <span>{s.label}</span>
            <strong className="mono">
              {s.default}
              <small> {s.unit}</small>
            </strong>
          </div>
        ))}
      </div>
    </>
  );
  const customizeAction = (
    <>
      <button
        data-testid="customize-design"
        className="button primary wide"
        onClick={customize}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="spin" size={18} />
        ) : (
          <SlidersHorizontal size={18} />
        )}{" "}
        {busy ? "Opening your workspace…" : "Make it yours"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="subtle">
        Your own editable copy, with every part connected.
      </p>
    </>
  );
  const included = (
    <details className="included"><summary>What comes with this design</summary>
      {[
        "Working mechanism in 3D",
        "Dimensions, materials and a shared workspace",
        "CAD files, parts list and assembly guide",
      ].map((s) => (
        <p key={s}>
          <Check size={16} />
          {s}
        </p>
      ))}
    </details>
  );
  return (
    <main className="listing-page">
      <button className="button quiet back" onClick={() => navigate("/browse")}>
        <ArrowLeft size={16} /> All designs
      </button>
      <div className="listing-layout">
        <div className="listing-copy">
          <header className="listing-heading">{heading}</header>
          {stage}
          <div className="listing-customize">{customizeAction}</div>
          <div className="listing-details">{details}</div>
          {included}
        </div>
      </div>
      <section className="listing-bottom">
        <div>
          <h2>Preview the assembly</h2>
          <p>
            Make a copy to review every step with your dimensions.
          </p>
        </div>
        <ol>
          {snapshot.derived.steps.slice(0, 3).map((s, i) => (
            <li key={s.id}>
              <div className="step-preview">
                <ModelCanvas
                  compact
                  parts={snapshot.derived.parts.filter((p) =>
                    s.partIds.includes(p.id),
                  )}
                  ariaLabel={s.title + " components"}
                />
              </div>
              <div className="step-copy">
                <span className="eyebrow">Step {i + 1}</span>
                <strong>{s.title}</strong>
                <p>{s.instruction}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
function Work({ navigate }: { navigate: Navigate }) {
  const items = recent();
  return (
    <main className="work-page">
      <h1>Pick up where you left off.</h1>
      {!items.length ? (
        <div className="empty">
          <FolderOpen size={30} />
          <h3>Your first design starts here.</h3>
          <p>Make a copy of a working design or start with a simple shape.</p>
          <button className="button primary" onClick={() => navigate("/browse")}>
            Explore designs
          </button>
        </div>
      ) : (
        <div className="work-list">
          {items.map((r: Recent) => (
            <button
              className="work-row"
              key={r.id}
              onClick={() => navigate(pathFor(r.id, r.token))}
            >
              <Box size={24} />
              <div>
                <strong>{r.name}</strong>
                <span>
                  {new Date(r.editedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
              <ChevronRight size={19} />
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
function NewDesign({ navigate }: { navigate: Navigate }) {
  const [name, setName] = useState("My desk organizer"),
    [shape, setShape] = useState<"box" | "rounded" | "cylinder" | "tube" | "ellipsoid">("box"),
    [width, setWidth] = useState(120),
    [height, setHeight] = useState(60),
    [depth, setDepth] = useState(80),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const part: Part = {
    id: "body",
    name: "Body",
    shape: shape === "rounded" ? "box" : shape,
    size: [width, height, shape === "box" || shape === "rounded" ? depth : width],
    holeDiameter: shape === "tube" ? width * 0.75 : undefined,
    edgeRadius: shape === "rounded" ? Math.round(Math.min(width, height, depth) * 2.5) / 10 : undefined,
    position: [0, height / 2, 0],
    color: colors.border,
    material: "PLA",
    process: "print",
  };
  async function begin() {
    setBusy(true);
    setError("");
    try {
      const r = await create("custom", name, [part]);
      navigate(pathFor(r.snapshot.design.id, r.access.editorToken));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function starter(name: string, parts: Part[]) {
    setBusy(true);
    setError("");
    try {
      const r = await create("custom", name, parts);
      navigate(pathFor(r.snapshot.design.id, r.access.editorToken));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const starters = [
    ...STARTERS.map((s) => ({ name: s.name as string, label: s.label as string, testId: s.testId as string | undefined, line: s.line as string, image: s.image as string, start: () => void starter(s.name, s.parts()) })),
    ...CATALOG.filter((p) => p.kind !== "custom").map((p) => ({ name: p.name, label: "Explore " + p.name, testId: undefined as string | undefined, line: p.description, image: `/previews/${p.kind}.png`, start: () => navigate("/designs/" + p.kind) })),
  ];
  return (
    <main className="new-page">
      <section className="new-ask" aria-labelledby="new-title">
        <h1 id="new-title">What are you making?</h1>
        <p>Describe it or pick a starting point. Then point at any part and say what to change.</p>
        <RequestBox navigate={navigate} still />
      </section>
      <section className="new-starters" aria-labelledby="new-starters-title">
        <h2 id="new-starters-title">Start from a working design</h2>
        <div className="starter-grid">
          {starters.map((s) => (
            <button key={s.name} className="starter-card" data-testid={s.testId} disabled={busy} onClick={s.start} aria-label={s.label}>
              <img src={s.image} alt="" loading="lazy" width="550" height="403" />
              <strong>{s.name}</strong>
              <span>{s.line}</span>
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      <section className="new-shape-section" aria-labelledby="new-shape-title">
        <h2 id="new-shape-title">Or start from a simple shape</h2>
        <p>Pick a shape and set its size. You can add parts in the studio.</p>
      <div className="new-layout">
        <div className="new-stage">
          <ModelCanvas parts={[part]} dimensions />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void begin();
          }}
          className="new-form"
        >
          <label>
            Design name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
            />
          </label>
          <label>
            First shape
            <select
              value={shape}
              onChange={(e) => setShape(e.target.value as typeof shape)}
            >
              <option value="box">Box</option>
              <option value="rounded">Rounded box</option>
              <option value="cylinder">Cylinder</option>
              <option value="tube">Tube</option>
              <option value="ellipsoid">Ellipsoid (ball or egg shape)</option>
            </select>
          </label>
          {[
            ["Width", width, setWidth],
            ["Height", height, setHeight],
            ...(shape === "box" || shape === "rounded" ? [["Depth", depth, setDepth]] : []),
          ].map(([label, value, set]) => (
            <label key={String(label)}>
              {String(label)} (mm)
              <input
                type="number"
                min="5"
                max="500"
                value={value as number}
                onChange={(e) =>
                  (set as (v: number) => void)(Number(e.target.value))
                }
                required
              />
            </label>
          ))}
          <button
            className="button primary wide"
            disabled={busy || width < 5 || height < 5 || depth < 5}
          >
            {busy ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}{" "}
            Create design
          </button>
        </form>
      </div>
      </section>
    </main>
  );
}
// The server names a seeded design whose before-and-after card is ready: { proofPath } or { proofPath: null }.
const EXAMPLES_ENDPOINT = "/api/examples";
// One path on a fresh camera drone, in order. Step 2 is decided by the local rules, so it needs no agent;
// step 3 is the change card's own check; step 4 makes the 3D model itself.
const JUDGE_STEPS = [
  ["Open the camera drone", "Drag to turn it around. Every part is real and editable."],
  ["Describe a change", "Click the top of an arm, then type or say “make this arm 6 mm thick”. The change card shows “4 → 6 mm thick”."],
  ["Check that it still holds", "On the change card, press Check it before applying. The same strength test runs on the arm as it is and as proposed, under the same motor thrust. Then press Apply change."],
  ["See it in your room", "Press See it in your room. The 3D model is made automatically; then scan the code to open the drone at real size on your phone."],
  ["Get build files", "Press Get build files to download the CAD files, parts list and assembly steps for the accepted design. Prepare build files makes them if they are not ready yet."],
] as const;
function Judge({ navigate }: { navigate: Navigate }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  // The server names a ready example with a before-and-after card; the button stays hidden without one.
  const [proofExample, setProofExample] = useState("");
  useEffect(() => {
    let stop = false;
    fetch(EXAMPLES_ENDPOINT).then((r) => (r.ok ? r.json() : null)).then((body) => {
      if (!stop && body && typeof body.proofPath === "string" && body.proofPath.startsWith("/") && !body.proofPath.startsWith("//")) setProofExample(body.proofPath);
    }).catch(() => {});
    return () => { stop = true; };
  }, []);
  async function startDrone() {
    setBusy(true);
    setError("");
    try {
      const r = await create("custom", "Camera drone", droneParts());
      navigate(pathFor(r.snapshot.design.id, r.access.editorToken));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="work-page judge-page">
      <h1>See what MakeAnything does, in five steps.</h1>
      <p className="lead">
        For makers, students and small hardware teams who want a part designed and checked without learning CAD. Today it starts from a camera drone, a desk arm and six other working designs. It designs and checks the parts; you print, cut or order them yourself.
      </p>
      <div className="judge-actions">
        <button className="button primary" disabled={busy} onClick={() => void startDrone()}>
          {busy ? <Loader2 size={17} className="spin" /> : null}Start with the camera drone <ChevronRight size={18} />
        </button>
        {proofExample && (
          <button className="button" onClick={() => navigate(proofExample)}>
            Open a before-and-after card <ChevronRight size={18} />
          </button>
        )}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="judge-steps">
        {JUDGE_STEPS.map(([title, body], i) => (
          <div key={title}>
            <span className="step-number">{i + 1}</span>
            <p><strong>{title}</strong> {body}</p>
          </div>
        ))}
      </div>
      <button className="button quiet small judge-more" onClick={() => navigate("/browse")}>
        Or start from another design <ChevronRight size={15} />
      </button>
    </main>
  );
}
