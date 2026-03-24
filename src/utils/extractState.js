export const STATE_MAP = {
  maharashtra: "Maharashtra",
  "tamil nadu": "Tamil Nadu",
  "uttar pradesh": "Uttar Pradesh",
  delhi: "Delhi",
  karnataka: "Karnataka",
  gujarat: "Gujarat",
  rajasthan: "Rajasthan",
  "madhya pradesh": "Madhya Pradesh",
  bihar: "Bihar",
  punjab: "Punjab",
  haryana: "Haryana",
  "west bengal": "West Bengal",
  wb: "West Bengal",
  odisha: "Odisha",
  kerala: "Kerala",
  telangana: "Telangana",
  "andhra pradesh": "Andhra Pradesh",
  uttarakhand: "Uttarakhand",
  meghalaya: "Meghalaya",
};

export const extractState = (address) => {
  if (!address) return null;

  const lower = address.toLowerCase();

  for (const key in STATE_MAP) {
    if (lower.includes(key)) {
      return STATE_MAP[key];
    }
  }

  return "Other";
};