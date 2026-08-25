import type { Device, DeviceIdentity } from "../lib/types";

/** Client-side fallback if backend identity is missing/outdated. */
export function resolveSkinIdentity(device: Device | null | undefined): DeviceIdentity {
  if (device?.identity?.skinId && device.identity.skinId !== "generic") {
    return device.identity;
  }
  if (device?.identity?.marketName && device.identity.marketName !== "Android phone") {
    return device.identity;
  }

  const brand = (device?.brand ?? "").toLowerCase();
  const model = (device?.model ?? "").toLowerCase().replace(/\s+/g, "");
  const codename = (device?.deviceCodename ?? device?.product ?? "").toLowerCase();
  const hay = `${brand} ${model} ${codename}`;

  if (
    hay.includes("kb2001") ||
    hay.includes("kb2003") ||
    hay.includes("kb2005") ||
    hay.includes("oneplus8t") ||
    codename === "kebab" ||
    (hay.includes("oneplus") && hay.includes("8t"))
  ) {
    return {
      brand: "OnePlus",
      model: device?.model,
      device: device?.deviceCodename,
      marketName: "OnePlus 8T",
      skinId: "oneplus-8t",
      aspectW: 1080,
      aspectH: 2400,
    };
  }

  if (hay.includes("oneplus") || brand === "oneplus") {
    return {
      brand: "OnePlus",
      model: device?.model,
      marketName: device?.model ? `OnePlus ${device.model}` : "OnePlus",
      skinId: "oneplus",
      aspectW: 9,
      aspectH: 20,
    };
  }

  if (hay.includes("pixel") || brand === "google") {
    return {
      brand: "Google",
      model: device?.model,
      marketName: device?.model ?? "Pixel",
      skinId: "pixel",
      aspectW: 9,
      aspectH: 20,
    };
  }

  if (hay.includes("samsung") || brand === "samsung" || model.startsWith("sm-")) {
    return {
      brand: "Samsung",
      model: device?.model,
      marketName: device?.model ?? "Samsung",
      skinId: "samsung",
      aspectW: 9,
      aspectH: 19,
    };
  }

  if (hay.includes("xiaomi") || hay.includes("redmi") || hay.includes("poco") || brand === "xiaomi") {
    return {
      brand: "Xiaomi",
      model: device?.model,
      marketName: device?.model ?? "Xiaomi",
      skinId: "xiaomi",
      aspectW: 9,
      aspectH: 20,
    };
  }

  return (
    device?.identity ?? {
      marketName: device?.model ?? "Android phone",
      skinId: "generic",
      aspectW: 9,
      aspectH: 19,
    }
  );
}
