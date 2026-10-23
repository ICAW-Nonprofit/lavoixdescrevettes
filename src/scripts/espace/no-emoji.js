// Stands in for emoji-mart and its data (see astro.config.mjs). BlockNote's emoji picker is turned off in the blog
// editor, but its data (which includes the shrimp emoji) would still ship with the site as a file nobody loads.
export default { categories: [], emojis: {}, aliases: {}, sheet: {} };
export const init = async () => {};
export const SearchIndex = { search: async () => [] };
