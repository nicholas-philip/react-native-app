export const generateReference = (type) => {
  const typeMap = {
    deposit: "DEP",
    withdrawal: "WDR",
    transfer: "TRF",
    payment: "PAY",
  };
  return (
    (typeMap[type] || "TXN") +
    Date.now() +
    Math.random().toString(36).substr(2, 9).toUpperCase()
  );
};
