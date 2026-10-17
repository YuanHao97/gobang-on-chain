export const PALETTES = [
  { name: "Violet", primary: "#8b5cf6", secondary: "#e9d5ff" },
  { name: "Ocean", primary: "#0891b2", secondary: "#a5f3fc" },
  { name: "Ember", primary: "#e65a25", secondary: "#fed7aa" },
  { name: "Jade", primary: "#059669", secondary: "#bbf7d0" },
  { name: "Rose", primary: "#db2777", secondary: "#fbcfe8" },
  { name: "Solar", primary: "#ca8a04", secondary: "#fef08a" }
];

export const BLACK_FALLBACK_SKIN = { style: "Black", palette: "Black", primary: "#171717", secondary: "#5b5b5b" };
export const WHITE_FALLBACK_SKIN = { style: "White", palette: "White", primary: "#e8e2d4", secondary: "#ffffff" };

export function skinFromMetadata(metadata, fallbackSkin) {
  const attributes = new Map((metadata?.attributes || []).map((attribute) => [attribute.trait_type, attribute.value]));
  const paletteName = attributes.get("Palette");
  const palette = PALETTES.find((item) => item.name === paletteName);
  if (!palette) return fallbackSkin;
  return {
    style: attributes.get("Style") || metadata.name || fallbackSkin.style,
    palette: palette.name,
    primary: palette.primary,
    secondary: palette.secondary
  };
}

export function skinFromMetadataURI(uri, fallbackSkin) {
  if (!uri?.startsWith("data:application/json;base64,")) return fallbackSkin;
  try {
    const encoded = uri.slice("data:application/json;base64,".length);
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return skinFromMetadata(JSON.parse(new TextDecoder().decode(bytes)), fallbackSkin);
  } catch {
    return fallbackSkin;
  }
}
