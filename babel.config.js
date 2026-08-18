/**
 * WatermelonDB models use legacy decorators (`@field`, `@relation`), which
 * Expo's preset does not enable by default. `legacy: true` is required — the
 * modern decorator proposal has different semantics and WatermelonDB's
 * decorators will not work under it.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [['@babel/plugin-proposal-decorators', { legacy: true }]],
  };
};
