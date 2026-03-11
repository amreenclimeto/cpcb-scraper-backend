
export const normalizeText = (text = "") => {
  if (!text) return "";

  let value = text
    .toLowerCase()
    .normalize("NFKD")            // unicode safety
    .replace(/[–—−]/g, "-");      // dash safety

  const replacements = {
    pvt: "private",
    ltd: "limited",
    co: "company",
    corp: "corporation",
    ind: "industries",
  };

  // keep words for replacement
  value = value.replace(/[^a-z0-9 ]/g, " ");
  value = value.replace(/\s+/g, " ").trim();

  const words = value.split(" ");

  const normalizedWords = words.map(
    
    (w) => replacements[w] || w
  );

  // 🔥 CRITICAL PRODUCTION STEP
  // remove spaces for DB-safe key
  return normalizedWords.join("").trim();
};
