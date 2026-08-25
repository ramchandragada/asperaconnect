import type { DeviceIdentity } from "../lib/types";

type Props = {
  identity?: DeviceIdentity | null;
  battery?: number | null;
  androidVersion?: string | null;
  connected?: boolean;
  mirroring?: boolean;
  className?: string;
};

/** Visual phone chassis matching detected model (bezel only — live stream is still scrcpy). */
export function PhoneBezel({
  identity,
  battery,
  androidVersion,
  connected = false,
  mirroring = false,
  className,
}: Props) {
  const skin = identity?.skinId ?? "generic";
  const name = identity?.marketName ?? "Android phone";
  const aspectW = identity?.aspectW ?? 9;
  const aspectH = identity?.aspectH ?? 19;

  return (
    <div className={`phone-bezel-wrap ${className ?? ""}`} data-skin={skin}>
      <div
        className="phone-chassis"
        style={{
          width: 210,
          aspectRatio: `${aspectW} / ${aspectH}`,
        }}
      >
        <div className={`phone-frame skin-${skin}`}>
          {skin === "oneplus-8t" || skin === "oneplus" ? (
            <div className="op-alert-slider" aria-hidden title="Alert slider" />
          ) : null}
          <CameraCutout skin={skin} />
          <div
            className="phone-screen"
            data-connected={connected}
            data-mirroring={mirroring}
          >
            <div className="phone-screen-inner">
              <div className="phone-status">
                <span>{androidVersion ? `A${androidVersion}` : "Android"}</span>
                <span>{battery != null ? `${battery}%` : "—"}</span>
              </div>
              <div className="phone-wallpaper" data-skin={skin} />
              <div className="phone-label">
                <strong>{name}</strong>
                <span className="phone-skin-id">{skin}</span>
                <span>{mirroring ? "Mirroring…" : connected ? "Ready" : "Waiting"}</span>
              </div>
            </div>
          </div>
          {skin === "samsung" ? <div className="phone-chin" /> : null}
        </div>
      </div>
      <p className="phone-bezel-hint">
        Preview only — mirror opens as a normal draggable scrcpy window.
      </p>
    </div>
  );
}

function CameraCutout({ skin }: { skin: string }) {
  if (skin === "oneplus-8t") {
    return <div className="cutout punch-hole center-top oneplus8t" aria-hidden />;
  }
  if (skin === "oneplus") {
    return <div className="cutout punch-hole center-top" aria-hidden />;
  }
  if (skin === "pixel") {
    return <div className="cutout punch-hole center-top pixel" aria-hidden />;
  }
  if (skin === "samsung") {
    return <div className="cutout punch-hole center-top samsung" aria-hidden />;
  }
  if (skin === "xiaomi") {
    return <div className="cutout punch-hole left-top" aria-hidden />;
  }
  return <div className="cutout notch" aria-hidden />;
}
