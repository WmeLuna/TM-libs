// @require      https://raw.githubusercontent.com/WmeLuna/TM-libs/main/exposeLibs.js
// @grant        unsafeWindow

typeof waitForElm != 'undefined' ? unsafeWindow.waitForElm = waitForElm : null;
typeof reactProps != 'undefined' ? unsafeWindow.reactProps = reactProps : null;
