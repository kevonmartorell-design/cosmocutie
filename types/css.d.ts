/**
 * Expo's Metro bundler handles plain `.css` imports for web, but TypeScript
 * has no built-in knowledge of them. This declares them as side-effect-only
 * modules so `import '@/global.css'` typechecks.
 */
declare module '*.css';
