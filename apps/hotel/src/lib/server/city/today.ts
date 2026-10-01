/** The city's "today" as `YYYY-MM-DD` — Manila time, like the income report. */
export const todayManila = () =>
	new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
