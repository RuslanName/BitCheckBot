function formatDate(date, includeTime = false) {
    const options = {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    };

    if (includeTime) {
        options.hour = "2-digit";
        options.minute = "2-digit";
        return new Date(date).toLocaleString("ru-RU", options).replace(", ", " в ");
    }

    return new Date(date).toLocaleString("ru-RU", options).replace(",", "");
}

module.exports = {
    formatDate
};

