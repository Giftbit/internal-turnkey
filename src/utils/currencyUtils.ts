/**
 * Format a currency value based on it's iso currency code, any specific formatting should be done here
 *
 * @param {number}value - Currency Value to format
 * @param {string}isoCurrencyCode - Currency Code
 * @returns {string} - Formatted Currency string ie: '$200,000.24`
 */
export const formatCurrency = (value: number, isoCurrencyCode: string = "USD"): string => {
    isoCurrencyCode = isoCurrencyCode.toLocaleUpperCase();
    if (isoCurrencyCode.substr(0, 2) === "XX") {
        return value.toString();
    } else {
        const options = (value * 0.01) % 1 === 0 ? {} : {
            style: "decimal",
            minimumFractionDigits: 2
        };

        return `$${(value * 0.01).toLocaleString(undefined, options)}`;
    }
};
