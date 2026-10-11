/* Chargé en premier (sans defer) pour appliquer le thème choisi avant l'affichage. */
(function () {
  try {
    var t = localStorage.getItem('bm-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    var l = localStorage.getItem('bm-lang');
    if ((l === 'fr' || l === 'en') && document.documentElement.getAttribute('data-dynamic') === '1') document.documentElement.lang = l;
  } catch (e) { /* stockage indisponible : thème automatique */ }
})();
