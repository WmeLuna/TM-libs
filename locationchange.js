// @require      https://raw.githubusercontent.com/WmeLuna/TM-libs/main/locationchange.js

(function() {
  var pushState = history.pushState;
  var replaceState = history.replaceState;
  history.pushState = function() {
    pushState.apply(history, arguments);
    window.dispatchEvent(new Event('pushstate'));
    window.dispatchEvent(new Event('locationchange'));
  };
  history.replaceState = function() {
    replaceState.apply(history, arguments);
    window.dispatchEvent(new Event('replacestate'));
    window.dispatchEvent(new Event('locationchange'));
  };
  window.addEventListener('popstate', function() {
    window.dispatchEvent(new Event('locationchange'))
  });
})();
