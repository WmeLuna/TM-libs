// @require      https://raw.githubusercontent.com/WmeLuna/TM-libs/main/reactProps.js

function reactProps (el) {
  if (typeof el !== 'object') return null;
  for (const key in el) {
    if (key.startsWith('__reactProps$')) {
      const props = el[key]?.children?.props || el[key];
      return typeof props === 'object' ? props : null;
    }
  }
  return null;
};
