/* ==========================================================================
   SUNSTONE TOWNS — interaction layer
   1. Header scroll state
   2. Scroll reveals
   3. Gallery drag-to-scroll
   4. Leaflet amenities map + clickable list
   5. Form handling
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 1. HEADER SCROLL STATE ------------------------------------------------- */
  var header = document.querySelector('.site-header');
  var lastKnown = 0, ticking = false;

  function onScroll() {
    lastKnown = window.scrollY || window.pageYOffset;
    if (!ticking) {
      window.requestAnimationFrame(function () {
        header.classList.toggle('is-stuck', lastKnown > 40);
        ticking = false;
      });
      ticking = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* 2. SCROLL REVEALS ------------------------------------------------------ */
  var revealTargets = document.querySelectorAll('[data-reveal]');

  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    revealTargets.forEach(function (el) { io.observe(el); });
  } else {
    revealTargets.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* 4. GALLERY DRAG-TO-SCROLL ----------------------------------------------- */
  var strip = document.querySelector('.gallery__strip');
  var progressBar = document.querySelector('.gallery__progress span');

  if (strip) {
    var isDown = false, startX, scrollLeft;

    strip.addEventListener('mousedown', function (e) {
      isDown = true;
      strip.classList.add('is-dragging');
      startX = e.pageX - strip.offsetLeft;
      scrollLeft = strip.scrollLeft;
    });
    window.addEventListener('mouseup', function () { isDown = false; strip.classList.remove('is-dragging'); });
    strip.addEventListener('mouseleave', function () { isDown = false; strip.classList.remove('is-dragging'); });
    strip.addEventListener('mousemove', function (e) {
      if (!isDown) return;
      e.preventDefault();
      var x = e.pageX - strip.offsetLeft;
      strip.scrollLeft = scrollLeft - (x - startX) * 1.4;
    });

    function updateProgress() {
      if (!progressBar) return;
      var max = strip.scrollWidth - strip.clientWidth;
      var pct = max > 0 ? strip.scrollLeft / max : 0;
      progressBar.style.left = 'calc(' + (pct * 100) + '% - ' + (pct * 8) + 'px)';
    }
    strip.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();
  }

  /* 4. LEAFLET AMENITIES MAP + CLICKABLE LIST -------------------------------
     A shared "amenities" data set drives both the sidebar list and the map
     markers, so clicking a list item pans/zooms the map to that marker and
     opens its popup — and vice versa. Markers use an upright circular pin
     (icon glyph is never rotated) with a small static pointer tail. */
  var mapEl = document.getElementById('sunstoneMap');
  if (mapEl && window.L) {
    var homeSvg     = '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>';
    var trainSvg     = '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 12h14M9 7v6M15 7v6M7.5 17 5 21M16.5 17 19 21"/>';
    var bagSvg     = '<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>';
    var roadSvg     = '<path d="M4 20 9 4h6l5 16"/><path d="M12 4v16M9.5 12h5"/>';
    var treeSvg     = '<path d="M12 3v18M12 3 7 9h10L12 3ZM12 9l-5 6h10l-5-6Z"/>';
    var cartSvg     = '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.6 12.4a2 2 0 0 0 2 1.6h8a2 2 0 0 0 2-1.6L21 8H6"/>';
    var schoolSvg     = '<path d="m2 9 10-5 10 5-10 5-10-5Z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>';
    var hospitalSvg = '<rect x="4" y="5" width="16" height="15" rx="1.5"/><path d="M12 9v6M9 12h6"/>';

    /* Coordinates re-verified against real, geocoded locations (not
       estimates) — Aug 2026. Site coordinate is the client-confirmed
       pin for Rutherford Rd & Peter Rupert Ave, Vaughan L6A 4T3. */
    var amenities = {
      site:     { coords: [43.840861, -79.4922884], modifier: 'site',     svg: homeSvg,     zoom: 15, title: 'Sunstone Towns',        body: 'Rutherford Rd &amp; Peter Rupert Ave, Vaughan' },
      transit:  { coords: [43.8364, -79.4923],  modifier: 'transit', svg: trainSvg,     zoom: 15, title: 'Rutherford GO Station',  body: '6 min walk from Sunstone Towns' },
      shop:     { coords: [43.8220, -79.5367],  modifier: 'shop',    svg: bagSvg,     zoom: 13, title: 'Vaughan Mills',       body: '5 min drive &middot; shopping &amp; dining' },
      hwy:      { coords: [43.8385, -79.5395],  modifier: 'hwy',     svg: roadSvg,     zoom: 13, title: 'Highway 400',   body: 'Quick access to the Greater Toronto Area' },
      park:     { coords: [43.8425, -79.4935],  modifier: 'park',    svg: treeSvg,     zoom: 15, title: 'Martin Tavares Park',       body: '5 min walk &middot; trails &amp; green space' },
      grocery:  { coords: [43.8580, -79.5175],  modifier: 'grocery', svg: cartSvg,     zoom: 13, title: 'Highland Farms',       body: '7 min drive &middot; grocery &amp; everyday shops' },
      school:   { coords: [43.8432, -79.4899],  modifier: 'school',  svg: schoolSvg,     zoom: 16, title: 'St. Cecilia Catholic Elementary', body: 'On Peter Rupert Ave &middot; Rom&eacute;o Dallaire P.S. also nearby' },
      hospital: { coords: [43.8672, -79.5375],  modifier: 'hospital',svg: hospitalSvg, zoom: 13, title: 'Cortellucci Vaughan Hospital',       body: '10 min drive &middot; Mackenzie Health' }
    };

    var map = L.map('sunstoneMap', {
      center: amenities.site.coords,
      zoom: 13,
      scrollWheelZoom: false,
      zoomControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 19
    }).addTo(map);

    function makeIcon(a) {
      return L.divIcon({
        className: 'map-pin map-pin--' + a.modifier,
        html:
          '<span class="map-pin__circle"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + a.svg + '</svg></span>' +
          '<span class="map-pin__tail"></span>',
        iconSize: [34, 44],
        iconAnchor: [17, 40],
        popupAnchor: [0, -38]
      });
    }

    Object.keys(amenities).forEach(function (key) {
      var a = amenities[key];
      a.marker = L.marker(a.coords, { icon: makeIcon(a) })
        .addTo(map)
        .bindPopup('<strong>' + a.title + '</strong>' + a.body);
      a.marker.on('click', function () { setActive(key); });
    });

    var listItems = document.querySelectorAll('#amenityList li');
    function setActive(key) {
      listItems.forEach(function (li) { li.classList.toggle('is-active', li.getAttribute('data-amenity') === key); });
      var a = amenities[key];
      if (!a) return;
      map.flyTo(a.coords, a.zoom, { duration: .7 });
      a.marker.openPopup();
    }

    listItems.forEach(function (li) {
      li.addEventListener('click', function () {
        setActive(li.getAttribute('data-amenity'));
      });
    });

    mapEl.addEventListener('click', function () { map.scrollWheelZoom.enable(); });
    mapEl.addEventListener('mouseleave', function () { map.scrollWheelZoom.disable(); });

    /* The map's height now matches the amenity list's rendered height
       (CSS grid stretch), so re-measure after fonts/images settle. */
    window.addEventListener('load', function () { map.invalidateSize(); });
    window.addEventListener('resize', function () { map.invalidateSize(); });
  }

  /* 5. FORM ---------------------------------------------------------------- */
  var form = document.querySelector('.form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      form.classList.add('is-sent');
      /* Swap this for a real POST to your CRM/form endpoint, then redirect
         on success. For now, send visitors straight to the thank-you page. */
      window.location.href = 'thank-you.html';
    });
  }

  /* init */
  onScroll();
})();
