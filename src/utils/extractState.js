export const STATE_MAP = {
  "andaman and nicobar": "Andaman and Nicobar Islands",
  "andhra pradesh": "Andhra Pradesh",
  "arunachal pradesh": "Arunachal Pradesh",
  assam: "Assam",
  bihar: "Bihar",
  chandigarh: "Chandigarh",
  chhattisgarh: "Chhattisgarh",
  "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
  delhi: "Delhi",
  "new delhi": "Delhi",
  "east delhi": "Delhi",
  "nct of delhi": "Delhi",
  goa: "Goa",
  gujarat: "Gujarat",
  haryana: "Haryana",
  "himachal pradesh": "Himachal Pradesh",
  jharkhand: "Jharkhand",
  "jammu and kashmir": "Jammu and Kashmir",
  "jammu & kashmir": "Jammu and Kashmir",
  karnataka: "Karnataka",
  kerala: "Kerala",
  ladakh: "Ladakh",
  lakshadweep: "Lakshadweep",
  "madhya pradesh": "Madhya Pradesh",
  maharashtra: "Maharashtra",
  manipur: "Manipur",
  meghalaya: "Meghalaya",
  mizoram: "Mizoram",
  nagaland: "Nagaland",
  odisha: "Odisha",
  orissa: "Odisha",
  puducherry: "Puducherry",
  pondicherry: "Puducherry",
  punjab: "Punjab",
  rajasthan: "Rajasthan",
  sikkim: "Sikkim",
  "tamil nadu": "Tamil Nadu",
  telangana: "Telangana",
  tripura: "Tripura",
  "uttar pradesh": "Uttar Pradesh",
  uttarakhand: "Uttarakhand",
  uttaranchal: "Uttarakhand",
  "west bengal": "West Bengal",
  wb: "West Bengal",
};

const STATE_KEYS_BY_LENGTH = Object.keys(STATE_MAP).sort(
  (a, b) => b.length - a.length,
);

export const extractState = (address) => {
  if (!address) return null;

  const lower = address.toLowerCase();

  for (const key of STATE_KEYS_BY_LENGTH) {
    if (lower.includes(key)) {
      return STATE_MAP[key];
    }
  }

  return null;
};
