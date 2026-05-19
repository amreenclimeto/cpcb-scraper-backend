export function parseStatesParam(states) {
  if (!states || states.toLowerCase() === "all") return [];

  const raw = Array.isArray(states)
    ? states
    : String(states).split(",");

  return raw.map((s) => s.trim()).filter(Boolean);
}