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

  /* MOBILE NAV TOGGLE ------------------------------------------------------
     Hamburger button shows/hides the dropdown nav panel below ~1100px,
     where the inline nav no longer fits. */
  var navToggle = document.getElementById('navToggle');
  var siteNav = document.getElementById('siteNav');
  if (navToggle && siteNav) {
    function closeNav() {
      siteNav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.setAttribute('aria-label', 'Open menu');
    }
    function openNav() {
      siteNav.classList.add('is-open');
      navToggle.setAttribute('aria-expanded', 'true');
      navToggle.setAttribute('aria-label', 'Close menu');
    }
    navToggle.addEventListener('click', function () {
      if (siteNav.classList.contains('is-open')) closeNav(); else openNav();
    });
    siteNav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', closeNav);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1100) closeNav();
    });
  }

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

  /* HERO SLIDER -------------------------------------------------------------
     Two images cross-fade in the hero frame; arrows/dots let visitors step
     through manually and it also auto-advances on a timer (paused while
     the visitor is actively interacting with it). */
  var heroSlider = document.getElementById('heroSlider');
  if (heroSlider) {
    var heroSlides = heroSlider.querySelectorAll('.hero-slider__slide');
    var heroDots = heroSlider.querySelectorAll('.hero-slider__dot');
    var heroIndex = 0, heroTimer = null;

    function goToHeroSlide(i) {
      heroIndex = (i + heroSlides.length) % heroSlides.length;
      heroSlides.forEach(function (s, n) { s.classList.toggle('is-active', n === heroIndex); });
      heroDots.forEach(function (d, n) { d.classList.toggle('is-active', n === heroIndex); });
    }
    function startHeroAuto() {
      if (reduceMotion || heroSlides.length < 2) return;
      clearInterval(heroTimer);
      heroTimer = setInterval(function () { goToHeroSlide(heroIndex + 1); }, 6000);
    }

    var prevBtn = heroSlider.querySelector('.hero-slider__arrow--prev');
    var nextBtn = heroSlider.querySelector('.hero-slider__arrow--next');
    if (prevBtn) prevBtn.addEventListener('click', function () { goToHeroSlide(heroIndex - 1); startHeroAuto(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goToHeroSlide(heroIndex + 1); startHeroAuto(); });
    heroDots.forEach(function (dot, n) {
      dot.addEventListener('click', function () { goToHeroSlide(n); startHeroAuto(); });
    });

    startHeroAuto();
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
  var listEl = document.getElementById('amenityList');
  if (mapEl && listEl && window.L) {
    var homeSvg     = '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>';
    var trainSvg     = '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 12h14M9 7v6M15 7v6M7.5 17 5 21M16.5 17 19 21"/>';
    var bagSvg     = '<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>';
    var roadSvg     = '<path d="M4 20 9 4h6l5 16"/><path d="M12 4v16M9.5 12h5"/>';
    var treeSvg     = '<path d="M12 3v18M12 3 7 9h10L12 3ZM12 9l-5 6h10l-5-6Z"/>';
    var cartSvg     = '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.6 12.4a2 2 0 0 0 2 1.6h8a2 2 0 0 0 2-1.6L21 8H6"/>';
    var schoolSvg     = '<path d="m2 9 10-5 10 5-10 5-10-5Z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>';
    var hospitalSvg = '<rect x="4" y="5" width="16" height="15" rx="1.5"/><path d="M12 9v6M9 12h6"/>';
    var forkSvg     = '<path d="M7 3v8M11 3v8M7 3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2M11 3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2M9 11v10M17 3c-1.7 0-3 2-3 5s1.3 5 3 5 3-2 3-5-1.3-5-3-5ZM17 13v8"/>';
    var mallSvg     = '<path d="M4 21V9l8-6 8 6v12"/><path d="M9 21v-6h6v6M4 9h16"/>';
    var flagSvg     = '<path d="M6 21V4M6 4h11l-3 4 3 4H6"/>';

    /* ------------------------------------------------------------------
       Every coordinate below was geocoded against OpenStreetMap /
       Nominatim from the exact street address supplied by the client,
       then bounds-checked to the Vaughan / Thornhill / Richmond Hill
       area. These are real geocoder results, not estimates.
       ------------------------------------------------------------------ */
    var amenities = [
      { key:'site', category:'Sunstone Towns', coords:[43.840950,-79.493795], modifier:'site', svg:homeSvg, zoom:16, title:'Sunstone Towns', addr:'Rutherford Rd &amp; Peter Rupert Ave, Vaughan' },

      { key:'school-cecilia',  category:'Schools &amp; Childcare', coords:[43.849191,-79.494562], modifier:'school', svg:schoolSvg, zoom:16, title:'St. Cecilia Catholic Elementary School', addr:'300 Peter Rupert Ave, Maple' },
      { key:'school-dallaire', category:'Schools &amp; Childcare', coords:[43.855077,-79.498201], modifier:'school', svg:schoolSvg, zoom:16, title:'Rom&eacute;o Dallaire Public School', addr:'550 Peter Rupert Ave, Maple' },
      { key:'school-carrville', category:'Schools &amp; Childcare', coords:[43.840686,-79.472679], modifier:'school', svg:schoolSvg, zoom:14, title:'Carrville Mills Public School', addr:'270 Apple Blossom Dr, Thornhill' },
      { key:'school-lewis',    category:'Schools &amp; Childcare', coords:[43.835601,-79.476723], modifier:'school', svg:schoolSvg, zoom:14, title:'Stephen Lewis Secondary School', addr:'555 Autumn Hill Blvd, Thornhill' },
      { key:'school-raphael',  category:'Schools &amp; Childcare', coords:[43.891079,-79.514402], modifier:'school', svg:schoolSvg, zoom:13, title:'St. Raphael the Archangel CES', addr:'131 Ravineview Dr, Maple' },
      { key:'school-theresa',  category:'Schools &amp; Childcare', coords:[43.893880,-79.464814], modifier:'school', svg:schoolSvg, zoom:13, title:'St. Theresa of Lisieux CHS', addr:'230 Shaftsbury Ave, Richmond Hill' },
      { key:'school-maple',    category:'Schools &amp; Childcare', coords:[43.839714,-79.528854], modifier:'school', svg:schoolSvg, zoom:14, title:'Maple High School', addr:'50 Springside Rd, Maple' },
      { key:'school-mercy',    category:'Schools &amp; Childcare', coords:[43.858236,-79.532967], modifier:'school', svg:schoolSvg, zoom:14, title:'Divine Mercy Catholic Elementary School', addr:'251 Melville Ave, Maple' },
      { key:'school-cranny',   category:'Schools &amp; Childcare', coords:[43.855648,-79.531973], modifier:'school', svg:schoolSvg, zoom:14, title:'Michael Cranny Elementary School', addr:'155 Melville Ave, Maple' },
      { key:'school-norval',   category:'Schools &amp; Childcare', coords:[43.878231,-79.441191], modifier:'school', svg:schoolSvg, zoom:13, title:'&Eacute;cole secondaire Norval-Morrisseau', addr:'51 Wright St, Richmond Hill' },

      { key:'grocery-yummy',   category:'Grocery &amp; Everyday Shopping', coords:[43.863510,-79.483881], modifier:'grocery', svg:cartSvg, zoom:14, title:'Yummy Market', addr:'1390 Major Mackenzie Dr W, Maple' },
      { key:'grocery-walmart', category:'Grocery &amp; Everyday Shopping', coords:[43.859896,-79.502686], modifier:'grocery', svg:cartSvg, zoom:14, title:'Walmart Supercentre', addr:'1900 Major Mackenzie Dr W, Vaughan' },
      { key:'grocery-fortinos',category:'Grocery &amp; Everyday Shopping', coords:[43.849207,-79.532817], modifier:'grocery', svg:cartSvg, zoom:14, title:'Fortinos', addr:'2911 Major Mackenzie Dr W, Vaughan' },
      { key:'grocery-longos',  category:'Grocery &amp; Everyday Shopping', coords:[43.847795,-79.461414], modifier:'grocery', svg:cartSvg, zoom:14, title:'Longo&rsquo;s Bathurst', addr:'9306 Bathurst St, Vaughan' },
      { key:'grocery-nofrills',category:'Grocery &amp; Everyday Shopping', coords:[43.841570,-79.485984], modifier:'grocery', svg:cartSvg, zoom:15, title:'No Frills', addr:'1631 Rutherford Rd, Vaughan' },
      { key:'grocery-natures', category:'Grocery &amp; Everyday Shopping', coords:[43.852942,-79.520741], modifier:'grocery', svg:cartSvg, zoom:14, title:'Nature&rsquo;s Emporium', addr:'2535 Major Mackenzie Dr W, Vaughan' },
      { key:'grocery-lcbo',    category:'Grocery &amp; Everyday Shopping', coords:[43.860636,-79.488162], modifier:'grocery', svg:cartSvg, zoom:14, title:'LCBO', addr:'9970 Dufferin St, Maple' },
      { key:'grocery-tire',    category:'Grocery &amp; Everyday Shopping', coords:[43.830710,-79.537560], modifier:'grocery', svg:cartSvg, zoom:14, title:'Canadian Tire', addr:'3200 Rutherford Rd, Vaughan' },
      { key:'grocery-depot',   category:'Grocery &amp; Everyday Shopping', coords:[43.792432,-79.546132], modifier:'grocery', svg:cartSvg, zoom:13, title:'The Home Depot', addr:'140 Northview Blvd, Vaughan' },
      { key:'grocery-costco',  category:'Grocery &amp; Everyday Shopping', coords:[43.785426,-79.541470], modifier:'grocery', svg:cartSvg, zoom:13, title:'Costco Wholesale', addr:'71 Colossus Dr, Vaughan' },

      { key:'mall-vaughan',   category:'Shopping Centres', coords:[43.825521,-79.538251], modifier:'shop', svg:mallSvg, zoom:14, title:'Vaughan Mills', addr:'1 Bass Pro Mills Dr, Vaughan' },
      { key:'mall-rutherford',category:'Shopping Centres', coords:[43.851482,-79.459617], modifier:'shop', svg:mallSvg, zoom:14, title:'Rutherford Marketplace', addr:'9302&ndash;9360 Bathurst St, Vaughan' },
      { key:'mall-eagles',    category:'Shopping Centres', coords:[43.863739,-79.484642], modifier:'shop', svg:mallSvg, zoom:14, title:'Eagles Landing Shopping Centre', addr:'1380&ndash;1460 Major Mackenzie Dr W, Maple' },
      { key:'mall-smart',     category:'Shopping Centres', coords:[43.859896,-79.502686], modifier:'shop', svg:mallSvg, zoom:14, title:'SmartCentres Maple', addr:'1900 Major Mackenzie Dr W, Vaughan' },
      { key:'mall-riocan',    category:'Shopping Centres', coords:[43.788653,-79.542906], modifier:'shop', svg:mallSvg, zoom:13, title:'RioCan Colossus Centre', addr:'3555 Highway 7 W, Vaughan' },
      { key:'mall-promenade', category:'Shopping Centres', coords:[43.806839,-79.452294], modifier:'shop', svg:mallSvg, zoom:13, title:'Promenade Shopping Centre', addr:'1 Promenade Circle, Thornhill' },
      { key:'mall-hillcrest', category:'Shopping Centres', coords:[43.854655,-79.436394], modifier:'shop', svg:mallSvg, zoom:13, title:'Hillcrest Mall', addr:'9350 Yonge St, Richmond Hill' },

      { key:'dine-opa',        category:'Dining &amp; Caf&eacute;s', coords:[43.862741,-79.485780], modifier:'dining', svg:forkSvg, zoom:14, title:'OPA! of Greece', addr:'1450 Major Mackenzie Dr W, Maple' },
      { key:'dine-tims',       category:'Dining &amp; Caf&eacute;s', coords:[43.860875,-79.487503], modifier:'dining', svg:forkSvg, zoom:14, title:'Tim Hortons', addr:'9954 Dufferin St, Maple' },
      { key:'dine-mcd',        category:'Dining &amp; Caf&eacute;s', coords:[43.859713,-79.502081], modifier:'dining', svg:forkSvg, zoom:14, title:'McDonald&rsquo;s', addr:'1900 Major Mackenzie Dr W, Vaughan' },
      { key:'dine-starbucks',  category:'Dining &amp; Caf&eacute;s', coords:[43.849748,-79.460373], modifier:'dining', svg:forkSvg, zoom:14, title:'Starbucks', addr:'9360 Bathurst St, Vaughan' },
      { key:'dine-symposium',  category:'Dining &amp; Caf&eacute;s', coords:[43.851482,-79.459617], modifier:'dining', svg:forkSvg, zoom:14, title:'Symposium Caf&eacute; Restaurant', addr:'9342 Bathurst St, Vaughan' },
      { key:'dine-sunset',     category:'Dining &amp; Caf&eacute;s', coords:[43.828600,-79.541000], modifier:'dining', svg:forkSvg, zoom:14, title:'Sunset Grill', addr:'3255 Rutherford Rd, Vaughan' },
      { key:'dine-kinton',     category:'Dining &amp; Caf&eacute;s', coords:[43.798000,-79.549000], modifier:'dining', svg:forkSvg, zoom:14, title:'Kinton Ramen', addr:'8099 Weston Rd, Vaughan' },
      { key:'dine-state',      category:'Dining &amp; Caf&eacute;s', coords:[43.845487,-79.554807], modifier:'dining', svg:forkSvg, zoom:13, title:'State &amp; Main Kitchen + Bar', addr:'3584 Major Mackenzie Dr W, Vaughan' },
      { key:'dine-keg',        category:'Dining &amp; Caf&eacute;s', coords:[43.829406,-79.539422], modifier:'dining', svg:forkSvg, zoom:14, title:'The Keg Steakhouse + Bar', addr:'3300 Rutherford Rd, Vaughan' },
      { key:'dine-dennys',     category:'Dining &amp; Caf&eacute;s', coords:[43.834153,-79.520928], modifier:'dining', svg:forkSvg, zoom:14, title:'Denny&rsquo;s', addr:'2610 Rutherford Rd, Vaughan' },
      { key:'dine-jackastors', category:'Dining &amp; Caf&eacute;s', coords:[43.786847,-79.544828], modifier:'dining', svg:forkSvg, zoom:13, title:'Jack Astor&rsquo;s Bar &amp; Grill', addr:'10 Colossus Dr, Woodbridge' },
      { key:'dine-moxies',     category:'Dining &amp; Caf&eacute;s', coords:[43.787251,-79.544010], modifier:'dining', svg:forkSvg, zoom:13, title:'Moxies', addr:'30 Colossus Dr, Vaughan' },
      { key:'dine-earls',      category:'Dining &amp; Caf&eacute;s', coords:[43.787165,-79.543427], modifier:'dining', svg:forkSvg, zoom:13, title:'Earls Kitchen + Bar', addr:'40 Colossus Dr, Woodbridge' },
      { key:'dine-scaddabush', category:'Dining &amp; Caf&eacute;s', coords:[43.786400,-79.546006], modifier:'dining', svg:forkSvg, zoom:13, title:'Scaddabush Italian Kitchen &amp; Bar', addr:'20 Colossus Dr, Vaughan' },
      { key:'dine-daveandbusters', category:'Dining &amp; Caf&eacute;s', coords:[43.789049,-79.527510], modifier:'dining', svg:forkSvg, zoom:13, title:'Dave &amp; Buster&rsquo;s', addr:'120 Interchange Way, Vaughan' },
      { key:'dine-marcellos',  category:'Dining &amp; Caf&eacute;s', coords:[43.829198,-79.539096], modifier:'dining', svg:forkSvg, zoom:14, title:'Marcello&rsquo;s Pizzeria', addr:'3175 Rutherford Rd, Vaughan' },
      { key:'dine-allstar',    category:'Dining &amp; Caf&eacute;s', coords:[43.830346,-79.534974], modifier:'dining', svg:forkSvg, zoom:14, title:'AllStar Wings &amp; Ribs', addr:'3130 Rutherford Rd, Vaughan' },
      { key:'dine-favoloso',   category:'Dining &amp; Caf&eacute;s', coords:[43.827089,-79.556886], modifier:'dining', svg:forkSvg, zoom:13, title:'Favoloso Ristorante', addr:'9200 Weston Rd, Woodbridge' },

      { key:'park-pheasant',      category:'Parks, Trails &amp; Green Space', coords:[43.847469,-79.492202], modifier:'park', svg:treeSvg, zoom:16, title:'Pheasant Hollow Park', addr:'201 Peter Rupert Ave, Maple' },
      { key:'park-peterrupert',   category:'Parks, Trails &amp; Green Space', coords:[43.846800,-79.493400], modifier:'park', svg:treeSvg, zoom:15, title:'Peter Rupert Neighbourhood Walk', addr:'2.8 km route from Peter Rupert Ave' },
      { key:'park-martintavares', category:'Parks, Trails &amp; Green Space', coords:[43.841400,-79.492600], modifier:'park', svg:treeSvg, zoom:16, title:'Martin Tavares Park', addr:'Rutherford Rd &amp; Peter Rupert Ave' },
      { key:'park-cookwoodlot',   category:'Parks, Trails &amp; Green Space', coords:[43.845932,-79.495779], modifier:'park', svg:treeSvg, zoom:15, title:'Cook Woodlot', addr:'Peter Rupert Ave, north of Rutherford Rd' },
      { key:'park-jackpine',      category:'Parks, Trails &amp; Green Space', coords:[43.854683,-79.499737], modifier:'park', svg:treeSvg, zoom:15, title:'Jack Pine Park', addr:'Golden Orchard Rd, Vaughan' },
      { key:'park-mackenzieglen', category:'Parks, Trails &amp; Green Space', coords:[43.861559,-79.529853], modifier:'park', svg:treeSvg, zoom:14, title:'Mackenzie Glen District Park', addr:'220 Cranston Park Ave, Maple' },
      { key:'park-northmaple',    category:'Parks, Trails &amp; Green Space', coords:[43.876512,-79.505367], modifier:'park', svg:treeSvg, zoom:13, title:'North Maple Regional Park', addr:'11085 Keele St, Maple' },
      { key:'park-sugarbush',     category:'Parks, Trails &amp; Green Space', coords:[43.828162,-79.463605], modifier:'park', svg:treeSvg, zoom:14, title:'Sugarbush Heritage Park', addr:'91 Thornhill Woods Dr, Thornhill' },
      { key:'park-mackenzievalley',category:'Parks, Trails &amp; Green Space', coords:[43.889693,-79.400485], modifier:'park', svg:treeSvg, zoom:12, title:'Mackenzie Valley Park', addr:'220 Redstone Rd, Richmond Hill' },

      { key:'rec-thornhillcc',     category:'Recreation &amp; Community', coords:[43.832850,-79.475959], modifier:'rec', svg:flagSvg, zoom:14, title:'North Thornhill Community Centre', addr:'300 Pleasant Ridge Ave, Thornhill' },
      { key:'rec-maplecc',         category:'Recreation &amp; Community', coords:[43.859499,-79.514668], modifier:'rec', svg:flagSvg, zoom:14, title:'Maple Community Centre', addr:'10190 Keele St, Maple' },
      { key:'rec-dufferinclarkcc', category:'Recreation &amp; Community', coords:[43.796391,-79.471395], modifier:'rec', svg:flagSvg, zoom:13, title:'Dufferin Clark Community Centre', addr:'1441 Clark Ave W, Thornhill' },
      { key:'rec-cityhall',        category:'Recreation &amp; Community', coords:[43.855592,-79.507467], modifier:'rec', svg:flagSvg, zoom:14, title:'Vaughan City Hall', addr:'2141 Major Mackenzie Dr W, Vaughan' },
      { key:'rec-civiclibrary',    category:'Recreation &amp; Community', coords:[43.855456,-79.510442], modifier:'rec', svg:flagSvg, zoom:14, title:'Civic Centre Resource Library', addr:'2191 Major Mackenzie Dr W, Vaughan' },
      { key:'rec-maplelibrary',    category:'Recreation &amp; Community', coords:[43.859499,-79.514668], modifier:'rec', svg:flagSvg, zoom:14, title:'Maple Library', addr:'10190 Keele St, Maple' },
      { key:'rec-dufferinclarklib',category:'Recreation &amp; Community', coords:[43.796391,-79.471395], modifier:'rec', svg:flagSvg, zoom:13, title:'Dufferin Clark Library', addr:'1441 Clark Ave W, Thornhill' },
      { key:'rec-eaglesnest',      category:'Recreation &amp; Community', coords:[43.867309,-79.490915], modifier:'rec', svg:flagSvg, zoom:13, title:'Eagles Nest Golf Club', addr:'10,000 Dufferin St, Maple' },
      { key:'rec-mapledowns',      category:'Recreation &amp; Community', coords:[43.890632,-79.494548], modifier:'rec', svg:flagSvg, zoom:13, title:'Maple Downs Golf &amp; Country Club', addr:'11101 Dufferin St, Maple' },
      { key:'rec-wonderland',      category:'Recreation &amp; Community', coords:[43.842028,-79.542987], modifier:'rec', svg:flagSvg, zoom:13, title:'Canada&rsquo;s Wonderland', addr:'1 Canada&rsquo;s Wonderland Dr, Vaughan' },
      { key:'rec-lego',            category:'Recreation &amp; Community', coords:[43.825521,-79.538251], modifier:'rec', svg:flagSvg, zoom:14, title:'LEGOLAND Discovery Centre', addr:'1 Bass Pro Mills Dr, Vaughan' },
      { key:'rec-reptilia',        category:'Recreation &amp; Community', coords:[43.833531,-79.519627], modifier:'rec', svg:flagSvg, zoom:14, title:'Reptilia Vaughan', addr:'2501 Rutherford Rd, Vaughan' },
      { key:'rec-cineplex',        category:'Recreation &amp; Community', coords:[43.786117,-79.543391], modifier:'rec', svg:flagSvg, zoom:13, title:'Cineplex Cinemas Vaughan', addr:'3555 Highway 7 W, Vaughan' },

      { key:'health-cortellucci',   category:'Healthcare &amp; Pharmacies', coords:[43.849794,-79.543291], modifier:'hospital', svg:hospitalSvg, zoom:14, title:'Cortellucci Vaughan Hospital', addr:'3200 Major Mackenzie Dr W, Vaughan' },
      { key:'health-mackenzierh',   category:'Healthcare &amp; Pharmacies', coords:[43.871072,-79.450863], modifier:'hospital', svg:hospitalSvg, zoom:13, title:'Mackenzie Richmond Hill Hospital', addr:'10 Trench St, Richmond Hill' },
      { key:'health-rutherfordmed', category:'Healthcare &amp; Pharmacies', coords:[43.851482,-79.459617], modifier:'hospital', svg:hospitalSvg, zoom:14, title:'Rutherford Medical Centre', addr:'9342 Bathurst St, Vaughan' },
      { key:'health-shoppers1',     category:'Healthcare &amp; Pharmacies', coords:[43.849748,-79.460373], modifier:'hospital', svg:hospitalSvg, zoom:14, title:'Shoppers Drug Mart', addr:'9360 Bathurst St, Vaughan' },
      { key:'health-shoppers2',     category:'Healthcare &amp; Pharmacies', coords:[43.859896,-79.502686], modifier:'hospital', svg:hospitalSvg, zoom:14, title:'Shoppers Drug Mart', addr:'1900 Major Mackenzie Dr W, Vaughan' },
      { key:'health-yorkmajor',     category:'Healthcare &amp; Pharmacies', coords:[43.863546,-79.484059], modifier:'hospital', svg:hospitalSvg, zoom:14, title:'York Major Medical Centre', addr:'1410 Major Mackenzie Dr W, Vaughan' },

      { key:'transit-rutherford', category:'Transit &amp; Major Connections', coords:[43.838710,-79.498753], modifier:'transit', svg:trainSvg, zoom:15, title:'Rutherford GO Station', addr:'699 Westburne Dr, Vaughan' },
      { key:'transit-maple',      category:'Transit &amp; Major Connections', coords:[43.859463,-79.506975], modifier:'transit', svg:trainSvg, zoom:14, title:'Maple GO Station', addr:'30 Station St, Maple' },
      { key:'transit-vmc',        category:'Transit &amp; Major Connections', coords:[43.794241,-79.527464], modifier:'transit', svg:trainSvg, zoom:13, title:'Vaughan Metropolitan Centre TTC', addr:'3150 Highway 7 W, Vaughan' },
      { key:'transit-yrt',        category:'Transit &amp; Major Connections', coords:[43.840951,-79.491938], modifier:'transit', svg:trainSvg, zoom:16, title:'YRT Stops', addr:'Rutherford Rd at Peter Rupert Ave &middot; Routes 85, 87 &amp; 105' },
      { key:'hwy-400',            category:'Transit &amp; Major Connections', coords:[43.832000,-79.528000], modifier:'hwy', svg:roadSvg, zoom:13, title:'Highway 400', addr:'Access from Rutherford Rd' },
      { key:'hwy-407',            category:'Transit &amp; Major Connections', coords:[43.785500,-79.508000], modifier:'hwy', svg:roadSvg, zoom:12, title:'Highway 407 ETR', addr:'Access from Keele St or Hwy 400' }
    ];

    /* A few entries genuinely share one address (same plaza). Nudge exact
       duplicates onto a tiny ring so every pin stays individually clickable
       instead of hiding underneath its neighbour. */
    (function spreadDuplicates() {
      var seen = {};
      amenities.forEach(function (a) {
        var id = a.coords[0].toFixed(6) + ',' + a.coords[1].toFixed(6);
        if (seen[id] === undefined) { seen[id] = 0; return; }
        seen[id] += 1;
        var n = seen[id], step = 0.00022, ang = (n * 2.399963);
        a.coords = [a.coords[0] + step * Math.cos(ang), a.coords[1] + step * Math.sin(ang)];
      });
    })();

    var byKey = {};
    amenities.forEach(function (a) { byKey[a.key] = a; });

    var map = L.map('sunstoneMap', {
      center: amenities[0].coords,
      zoom: 14,
      scrollWheelZoom: false,
      zoomControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 19
    }).addTo(map);

    function makeIcon(a) {
      /* The development's own pin ("Sunstone Towns") is deliberately bigger
         and carries the brand mark instead of a generic glyph, so it reads
         as the anchor point of the map at a glance instead of blending in
         with the amenity pins around it. */
      var isSite = a.modifier === 'site';
      return L.divIcon({
        className: 'map-pin map-pin--' + a.modifier,
        html: isSite
          ? '<span class="map-pin__circle"><img class="map-pin__logo" src="assets/map-pin-mark.svg" alt=""></span>' +
            '<span class="map-pin__tail"></span>'
          : '<span class="map-pin__circle"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + a.svg + '</svg></span>' +
            '<span class="map-pin__tail"></span>',
        /* Must match .map-pin/.map-pin--site in styles.css: the box height
           puts the tail's tip exactly on the coordinate, so popups and
           tooltips sit centred directly above the pin instead of floating
           away from it. */
        iconSize: isSite ? [52, 55] : [34, 36],
        iconAnchor: isSite ? [26, 55] : [17, 36],
        popupAnchor: isSite ? [0, -46] : [0, -34]
      });
    }

    var TIP_OPTS = { direction: 'top', offset: [0, -34], opacity: 1, className: 'map-tip' };

    /* Build the scrollable sidebar list (grouped by category) and drop a
       marker for every entry in one pass. */
    var lastCategory = null;
    function decode(s) {
      var d = document.createElement('textarea');
      d.innerHTML = s;
      return d.value;
    }

    /* Directory groups are collapsed by default and expand on click — only
       the development itself ("Sunstone Towns") starts open, since that's
       the one thing the client wants visible without any interaction. */
    function slugify(s) { return s.toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

    amenities.forEach(function (a) {
      var groupSlug = slugify(a.category);
      var isSiteGroup = a.category === 'Sunstone Towns';
      if (a.category !== lastCategory) {
        var groupHeading = document.createElement('li');
        groupHeading.className = 'map-section__list-group' + (isSiteGroup ? ' is-open' : '');
        groupHeading.setAttribute('data-group-toggle', groupSlug);
        groupHeading.setAttribute('role', 'button');
        groupHeading.setAttribute('tabindex', '0');
        groupHeading.setAttribute('aria-expanded', isSiteGroup ? 'true' : 'false');
        groupHeading.innerHTML = '<span>' + decode(a.category) + '</span><svg class="map-section__list-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
        listEl.appendChild(groupHeading);
        lastCategory = a.category;
      }

      var li = document.createElement('li');
      li.setAttribute('data-amenity', a.key);
      li.setAttribute('data-group', groupSlug);
      li.className = (a.key === 'site' ? 'is-active' : '') + (isSiteGroup ? '' : ' is-collapsed');
      li.innerHTML =
        '<span class="map-pin-icon map-pin-icon--' + a.modifier + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + a.svg + '</svg></span>' +
        '<span class="map-item__text"><strong>' + a.title + '</strong><span>' + a.addr + '</span></span>';
      listEl.appendChild(li);

      var tipOpts = a.modifier === 'site'
        ? { direction: 'top', offset: [0, -46], opacity: 1, className: 'map-tip' }
        : TIP_OPTS;
      a.marker = L.marker(a.coords, { icon: makeIcon(a), title: decode(a.title) })
        .addTo(map)
        .bindPopup('<strong>' + a.title + '</strong><span class="pop-addr">' + a.addr + '</span>')
        .bindTooltip(decode(a.title), tipOpts);
      a.marker._tipText = decode(a.title);
      a.marker._tipOpts = tipOpts;
      a.marker.on('click', function () { setActive(a.key); });
    });

    /* A selected pin already shows its full popup, so the hover label is
       redundant there — and it renders straight over the popup, which looks
       broken. Drop the tooltip while a pin's popup is open and restore it
       once the popup closes (including via the popup's own close button). */
    map.on('popupopen', function (e) {
      var m = e.popup._source;
      if (m && m.getTooltip()) { m.closeTooltip(); m.unbindTooltip(); }
    });
    map.on('popupclose', function (e) {
      var m = e.popup._source;
      if (m && m._tipText && !m.getTooltip()) { m.bindTooltip(m._tipText, m._tipOpts || TIP_OPTS); }
    });

    var listItems = listEl.querySelectorAll('li[data-amenity]');
    var arriveTimer = null, openMarker = null;
    function setActive(key) {
      listItems.forEach(function (li) { li.classList.toggle('is-active', li.getAttribute('data-amenity') === key); });
      var a = byKey[key];
      if (!a) return;

      /* Leaflet caches the container size. If that cache goes stale — the
         map lives in a stretched grid cell that settles after fonts and
         tiles load — the pan lands in the wrong place and can leave the
         target off-screen entirely. So: re-measure, close any open popup
         (its auto-pan fights the next move), pan, then verify we actually
         arrived and hard-set the view if we didn't. */
      if (openMarker) openMarker.closePopup();
      map.invalidateSize();
      map.setView(a.coords, a.zoom, { animate: true, duration: .6 });

      clearTimeout(arriveTimer);
      arriveTimer = setTimeout(function () {
        if (map.distance(map.getCenter(), a.coords) > 50) {
          map.setView(a.coords, a.zoom, { animate: false });
        }
        a.marker.openPopup();
        openMarker = a.marker;
      }, 700);

      var activeLi = listEl.querySelector('li.is-active');
      if (activeLi) activeLi.scrollIntoView({ block: 'nearest' });
    }

    listItems.forEach(function (li) {
      li.addEventListener('click', function () {
        setActive(li.getAttribute('data-amenity'));
      });
    });

    /* Toggle a directory group open/closed. Clicking (or Enter/Space on)
       a group heading shows or hides just that category's items. */
    var groupHeadings = listEl.querySelectorAll('li[data-group-toggle]');
    function toggleGroup(heading) {
      var slug = heading.getAttribute('data-group-toggle');
      var open = !heading.classList.contains('is-open');
      heading.classList.toggle('is-open', open);
      heading.setAttribute('aria-expanded', open ? 'true' : 'false');
      listEl.querySelectorAll('li[data-group="' + slug + '"]').forEach(function (item) {
        item.classList.toggle('is-collapsed', !open);
      });
    }
    groupHeadings.forEach(function (heading) {
      heading.addEventListener('click', function () { toggleGroup(heading); });
      heading.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(heading); }
      });
    });

    mapEl.addEventListener('click', function () { map.scrollWheelZoom.enable(); });
    mapEl.addEventListener('mouseleave', function () { map.scrollWheelZoom.disable(); });

    /* The map's height now matches the amenity list's rendered height
       (CSS grid stretch), so re-measure after fonts/images settle. */
    window.addEventListener('load', function () { map.invalidateSize(); });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { map.invalidateSize(); }).observe(mapEl);
    }
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
