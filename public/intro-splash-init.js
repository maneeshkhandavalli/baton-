/* Baton landing intro splash (components/marketing/intro-splash.tsx). Loaded as a classic, parser-blocking script
   right after the splash markup, so it decides before first paint whether the splash shows: only with JavaScript,
   only when motion is allowed, once per tab session (sessionStorage), never if storage is unavailable. A static
   file instead of an inline script keeps the app free of dangerouslySetInnerHTML (IT-04). */
(function(){try{var e=document.currentScript&&document.currentScript.previousElementSibling;if(!e||!matchMedia("(prefers-reduced-motion: no-preference)").matches)return;if(sessionStorage.getItem("baton:intro-seen"))return;sessionStorage.setItem("baton:intro-seen","1");e.setAttribute("data-t",String(Math.round(performance.now())));e.setAttribute("data-show","")}catch{}})();
