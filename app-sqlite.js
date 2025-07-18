// Configuration loaded from HTML data attributes
const CONFIG = (() => {
  return {
    GAMES_PER_PAGE: 60,
    MAX_DESCRIPTION_LENGTH: 400,
    GAUGE_RADIUS: 10,
    COMPLEXITY_THRESHOLDS: [1.5, 2.5, 3.5, 4.5],
    COMPLEXITY_NAMES: ['Light', 'Light Medium', 'Medium', 'Medium Heavy', 'Heavy'],
    PLAYING_TIMES: ['< 30min', '30min - 1h', '1-2h', '2-3h', '3-4h', '> 4h'],
    WISHLIST_NAMES: ['Must Have', 'Love to Have', 'Like to Have', 'Thinking About It', 'Don\'t Buy', 'Own', 'PreOrdered'],
    SORT_OPTIONS: [
      { value: 'name', text: 'Name (A-Z)' },
      { value: 'rank', text: 'BGG Rank' },
      { value: 'rating', text: 'Rating' },
      { value: 'numowned', text: 'Most Owned' },
      { value: 'numrated', text: 'Most Rated' },
      { value: 'lastmod', text: 'Last Modified' }
    ]
  };
})();

// Legacy constants for compatibility
const GAMES_PER_PAGE = CONFIG.GAMES_PER_PAGE;
const MAX_DESCRIPTION_LENGTH = CONFIG.MAX_DESCRIPTION_LENGTH;
const GAUGE_RADIUS = CONFIG.GAUGE_RADIUS;

const NO_IMAGE_AVAILABLE = 'https://cf.geekdo-images.com/zxVVmggfpHJpmnJY9j-k1w__original/img/eBeOyAv08r-qFkQmVKhtBg_netU=/0x0/filters:format(jpeg)/pic1657689.jpg'

// Global state
let db = null;
let allGames = [];
let filteredGames = [];
let currentPage = 1;
let hoverWrapper;
let imgPopup;

// Utility functions
function showError(message) {
  const container = document.getElementById('hits');
  const template = document.getElementById('error-template');
  const clone = template.content.cloneNode(true);
  clone.querySelector('.error-message').textContent = message;
  container.innerHTML = '';
  container.appendChild(clone);
}

function createElement(tag, attributes = {}, textContent = '') {
  const element = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else {
      element.setAttribute(key, value);
    }
  });
  if (textContent) element.textContent = textContent;
  return element;
}

function createTagChipsContainer(chips) {
  if (!chips || chips.length === 0) return '';
  const template = document.getElementById('tag-chips-container-template');
  const clone = template.content.cloneNode(true);
  const container = clone.querySelector('.tag-chips');
  container.innerHTML = chips;
  return container.outerHTML;
}

// Core application functions
function loadINI(path, callback) {
  fetch(path)
    .then(response => response.text())
    .then(text => {
      const config = {};
      const lines = text.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Parse key = value pairs
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim();
          let value = trimmed.substring(equalIndex + 1).trim();

          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          config[key] = value;
        }
      }

      // Transform flat config into nested structure expected by the app
      const settings = {
        title: config.title || "MyBGG",
        bgg: {
          username: config.bgg_username
        },
        github: {
          repo: config.github_repo,
        }
      };

      callback(settings);
    })
    .catch(error => console.error('Error loading config:', error));
}

async function initializeDatabase(settings) {
  try {
    const SQL = await initSqlJs({
      locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/${file}`
    });

    const isDev = /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname);
    const dbUrl = isDev ? './mybgg.sqlite.gz' :
      `https://cors-proxy.mybgg.workers.dev/${settings.github.repo}`;

    console.log(`Loading database from: ${dbUrl}`);

    const response = await fetch(dbUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch database: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const dbData = fflate.gunzipSync(bytes);
    db = new SQL.Database(dbData);
    console.log('Database loaded successfully');

    loadAllGames();
    initializeUI();

  } catch (error) {
    console.error('Error initializing database:', error);

    let userMessage = 'Failed to load your board game database. ';

    if (error.message.includes('404') || error.message.includes('Failed to fetch')) {
      userMessage += 'This usually means:\n\n' +
        '• You haven\'t run the setup script yet (python scripts/download_and_index.py --cache_bgg)\n' +
        '• The database upload failed\n' +
        '• GitHub Pages isn\'t enabled or is still setting up (can take 10-15 minutes)\n\n' +
        'Try running the script again, and make sure GitHub Pages is enabled in your repository settings.';
    } else if (error.message.includes('gzip')) {
      userMessage += 'The database file appears to be corrupted. Try running the setup script again.';
    } else {
      userMessage += `Technical error: ${error.message}`;
    }

    showError(userMessage);
  }
}

function parsePlayerCount(countStr) {
  if (!countStr) return { min: 0, max: 0, open: false };
  let s = String(countStr).trim();

  if (s.endsWith('+')) {
    const numPart = s.slice(0, -1);
    const min = parseInt(numPart, 10);
    if (String(min) === numPart) {
      return { min: min, max: Infinity, open: true };
    }
  }

  const rangeMatch = s.match(/^(\d+)[–-](\d+)$/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    return { min: min, max: max, open: false };
  }

  const num = parseInt(s, 10);
  if (!isNaN(num)) {
    if (String(num) === s) {
      return { min: num, max: num, open: false };
    }
  }

  return { min: 0, max: 0, open: false };
}

function ftsSearch(query) {

  //return
  const stmt = db.prepare(`select rowid, name from games_fts where games_fts match "${query}"`)

  allGames = []
  while(stmt.step()) {
    const row = stmt.getAsObject();

    log.console(row);
  }

}

function loadAllGames() {
  const stmt = db.prepare(`
    SELECT id, name, description, categories, mechanics, players, weight,
           playing_time, min_age, rank, usersrated, numowned, rating,
           numplays, image, thumbnail, tags, previous_players, expansions, color, unixepoch(last_modified) as last_modified,
           publishers, designers, artists, year, wishlist_priority, accessories, po_exp, po_acc, wl_exp, wl_acc,
           alternate_names, comment, wishlist_comment, families, reimplements, reimplementedby, integrates, contained,
           weightRating, other_ranks, average, suggested_age, first_played, last_played, version_name, version_year
    FROM games
    ORDER BY name
  `);

  allGames = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();

    row.weight = parseFloat(row.weight);

    try {
      row.categories = JSON.parse(row.categories || '[]');
      row.mechanics = JSON.parse(row.mechanics || '[]');
      row.players = JSON.parse(row.players || '[]');
      row.tags = JSON.parse(row.tags || '[]');
      row.previous_players = JSON.parse(row.previous_players || '[]');
      row.expansions = JSON.parse(row.expansions || '[]');
      row.accessories = JSON.parse(row.accessories || '[]');
      row.publishers = JSON.parse(row.publishers || '[]');
      row.designers = JSON.parse(row.designers || '[]');
      row.artists = JSON.parse(row.artists || '[]');
      row.po_exp = JSON.parse(row.po_exp || '[]');
      row.po_acc = JSON.parse(row.po_acc || '[]');
      row.wl_exp = JSON.parse(row.wl_exp || '[]');
      row.wl_acc = JSON.parse(row.wl_acc || '[]');
      row.alternate_names = JSON.parse(row.alternate_names || '[]');
      row.families = JSON.parse(row.families || '[]');
      row.reimplements = JSON.parse(row.reimplements || '[]');
      row.reimplementedby = JSON.parse(row.reimplementedby || '[]');
      row.integrates = JSON.parse(row.integrates || '[]');
      row.contained = JSON.parse(row.contained || '[]');
      row.other_ranks = JSON.parse(row.other_ranks, '[]');
    } catch (e) {
      console.warn('Error parsing JSON for game:', row.id, e);
    }

    allGames.push(row);
  }
  stmt.free();

  filteredGames = [...allGames];
  console.log(`Loaded ${allGames.length} games.`);
}

function initializeUI() {
  setupSearchBox();
  setupFilters();
  setupSorting();

  const initialState = getFiltersFromURL();
  updateUIFromState(initialState);
  applyFiltersAndSort(initialState);
  updateResults();
  updateStats();

  window.addEventListener('popstate', (event) => {
    const state = event.state || getFiltersFromURL();
    updateUIFromState(state);
    applyFiltersAndSort(state);
    updateResults();
    updateStats();
  });

  window.addEventListener('resize', function () {
    const openDetails = document.querySelector('details[open] .game-details');
    if (openDetails) {
      const trigger = openDetails.closest('details').querySelector('summary');
      if (trigger) {
        positionPopupInViewport(openDetails, trigger);
      }
    }
  });
}

function handleMoreButtonClick(button) {
  const teaserText = button.closest('.teaser-text');
  if (!teaserText) return;

  const fullText = teaserText.getAttribute('data-full-text');

  if (button.textContent === 'more') {
    const template = document.getElementById('less-button-template');
    const clone = template.content.cloneNode(true);
    teaserText.innerHTML = escapeHtml(fullText) + ' ' + clone.querySelector('button').outerHTML;
  } else {
    teaserText.innerHTML = getTeaserText(fullText, true);
  }
}

function setupSearchBox() {
  const input = document.getElementById('search-input');
  const clearButton = document.getElementById('clear-button');

  // Show/hide the clear button based on input value
  input.addEventListener('input', debounce((event) => {
    clearButton.style.display = event.target.value ? 'block' : 'none'; // Show/hide clear button

    // Call the debounced `onFilterChange`
    onFilterChange(event);
  }, 300));

  // Clear the input field when the clear button is clicked
  clearButton.addEventListener('click', () => {
    input.value = ''; // Clear input
    clearButton.style.display = 'none'; // Hide the button
    input.focus(); // Refocus on the input field
    input.dispatchEvent(new Event('input')); // Trigger any input listeners
  });
}

function setupSorting() {
  const sortContainer = document.getElementById('sort-by');
  const select = createElement('select', {
    id: 'sort-select',
    name: 'sort-by'
  });

  const options = [
    { value: 'name', text: 'Name (A-Z)' },
    { value: 'rank', text: 'BGG Rank' },
    { value: 'rating', text: 'Rating' },
    { value: 'numowned', text: 'Most Owned' },
    { value: 'numrated', text: 'Most Rated' },
    { value: 'lastmod', text: 'Last Modified' },
  ];

  options.forEach(({ value, text }) => {
    const option = createElement('option', { value }, text);
    select.appendChild(option);
  });

  sortContainer.appendChild(select);
  select.addEventListener('change', onFilterChange);
}

function setupFilters() {
  setupCategoriesFilter();
  setupMechanicsFilter();
  setupPlayersFilter();
  setupWeightFilter();
  setupPlayingTimeFilter();
  setupMinAgeFilter();
  setupPreviousPlayersFilter();
  setupNumPlaysFilter();
  setupPublisherFilter();
  setupDesignerFilter();
  setupArtistFilter();
  setupYearFilter();
  setupStatusFilter();
  setupWishlistFilter();
  setupAgeRangeFilter();
  setupClearAllButton();

  // Ensure player sub-options are hidden initially
  hideAllPlayerSubOptions();

  // Ensure "Any" is checked by default for players filter
  ensurePlayerAnyIsSelected();
}

function hideAllPlayerSubOptions() {
  const allPlayerLabels = document.querySelectorAll('#facet-players label.filter-item[data-level]');
  allPlayerLabels.forEach(label => {
    const level = parseInt(label.dataset.level, 10);
    if (level > 0) {
      label.style.display = 'none';
    }
  });
}

function ensurePlayerAnyIsSelected() {
  const playersContainer = document.getElementById('facet-players');
  if (!playersContainer) return;

  const anyInput = playersContainer.querySelector('input[value="any"]');
  if (anyInput && !anyInput.checked) {
    anyInput.checked = true;
  }

  // Make sure all sub-options are hidden when "Any" is selected
  hideAllPlayerSubOptions();
}

function setupCategoriesFilter() {
  const categoryCounts = {};
  allGames.forEach(game => {
    game.categories.forEach(cat => {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
  });

  const sortedCategories = Object.keys(categoryCounts).sort();
  const items = sortedCategories.map(cat => ({
    label: cat,
    value: cat,
    count: categoryCounts[cat]
  }));

  // Only create the filter if there are categories
  if (items.length > 0) {
    createRefinementFilter('facet-categories', 'Categories', items, 'categories', false, true);
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-categories');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupMechanicsFilter() {
  const mechanicCounts = {};
  allGames.forEach(game => {
    game.mechanics.forEach(mech => {
      mechanicCounts[mech] = (mechanicCounts[mech] || 0) + 1;
    });
  });

  const sortedMechanics = Object.keys(mechanicCounts).sort();
  const items = sortedMechanics.map(mech => ({
    label: mech,
    value: mech,
    count: mechanicCounts[mech]
  }));

  // Only create the filter if there are mechanics
  if (items.length > 0) {
    createRefinementFilter('facet-mechanics', 'Mechanics', items, 'mechanics', false, true);
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-mechanics');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupPlayersFilter() {
  const playerCounts = new Set();
  allGames.forEach(game => {
    game.players.forEach(([count, type]) => {
      if (type === 'not recommended') return;

      const { min, max } = parsePlayerCount(count);
      if (min > 0) {
        const upper = isFinite(max) ? max : min;
        for (let i = min; i <= upper; i++) {
          playerCounts.add(i);
        }
      }
    });
  });

  const sortedPlayers = Array.from(playerCounts).sort((a, b) => a - b);

  const playerItems = [{
    label: 'Any',
    value: 'any',
    default: true,
    count: allGames.length,
    level: 0
  }];

  // Add main player count options and their sub-options
  sortedPlayers.forEach(p => {
    const mainCount = allGames.filter(game => {
      return game.players.some(([playerCount, type]) => {
        if (type === 'not recommended') return false;
        const { min, max } = parsePlayerCount(playerCount);
        return p >= min && p <= max;
      });
    }).length;

    // Main player count option
    playerItems.push({
      label: `${p} player${p === 1 ? '' : 's'}`,
      value: p.toString(),
      count: mainCount,
      level: 0
    });

    // Sub-options for different recommendation types
    const recommendationTypes = ['best', 'recommended', 'expansion'];
    recommendationTypes.forEach(recType => {
      const typeCount = allGames.filter(game => {
        return game.players.some(([playerCount, type]) => {
          if (type !== recType) return false;
          const { min, max } = parsePlayerCount(playerCount);
          return p >= min && p <= max;
        });
      }).length;

      if (typeCount > 0) {
        const typeLabel = recType === 'best' ? 'Best with' :
                         recType === 'recommended' ? 'Recommended with' :
                         'Expansions allow';

        playerItems.push({
          label: `${typeLabel} ${p} player${p === 1 ? '' : 's'}`,
          value: `${p}-${recType}`,
          count: typeCount,
          level: 1,
          parentValue: p.toString()
        });
      }
    });
  });

  createRefinementFilter('facet-players', 'Number of players', playerItems, 'players', true);
}

function setupWeightFilter() {
  const weightCounts = {};
  allGames.forEach(game => {
    if (game.weight) {
      const name = getComplexityName(game.weight);
      if (name) {
        weightCounts[name] = (weightCounts[name] || 0) + 1;
      }
    }
  });

  const items = CONFIG.COMPLEXITY_NAMES.map(name => ({
    label: name,
    value: name,
    count: weightCounts[name] || 0
  }));

  // Check if all items have zero count (effectively empty filter)
  const hasAnyItems = items.some(item => item.count > 0);
  if (hasAnyItems) {
    createRefinementFilter('facet-weight', 'Complexity', items, 'weight');
  } else {
    // Hide the filter container if no items have counts
    const container = document.getElementById('facet-weight');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupPlayingTimeFilter() {
  const timeCounts = {};
  allGames.forEach(game => {
    if (game.playing_time) {
      timeCounts[game.playing_time] = (timeCounts[game.playing_time] || 0) + 1;
    }
  });

  const items = CONFIG.PLAYING_TIMES.map(time => ({
    label: time,
    value: time,
    count: timeCounts[time] || 0
  }));

  // Check if all items have zero count (effectively empty filter)
  const hasAnyItems = items.some(item => item.count > 0);
  if (hasAnyItems) {
    createRefinementFilter('facet-playing-time', 'Playing time', items, 'playing_time');
  } else {
    // Hide the filter container if no items have counts
    const container = document.getElementById('facet-playing-time');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupMinAgeFilter() {
  const ageRanges = [{
    label: 'Any age',
    min: 0,
    max: 100,
    default: true
  }, {
    label: '< 5 years',
    min: 0,
    max: 4
  }, {
    label: '< 7 years',
    min: 0,
    max: 6
  }, {
    label: '< 9 years',
    min: 0,
    max: 8
  }, {
    label: '< 11 years',
    min: 0,
    max: 10
  }, {
    label: '< 13 years',
    min: 0,
    max: 12
  }, {
    label: '< 15 years',
    min: 0,
    max: 14
  }, {
    label: '15+',
    min: 15,
    max: 100
  }];

  const items = ageRanges.map(range => {
    const count = allGames.filter(game => {
      if (range.default) return true;
      return game.min_age >= range.min && game.min_age <= range.max;
    }).length;
    return {
      ...range,
      count: range.default ? allGames.length : count
    };
  });

  createRefinementFilter('facet-min-age', 'Min age', items, 'min_age', true);
}

function setupAgeRangeFilter() {
  const maxAge = Math.max(...allGames.map(game => game.min_age));
  const minAge = Math.min(...allGames.map(game => game.min_age));

  // Initialize a slider refinement filter
  createSliderRefinementFilter('facet-age-range', 'Min age', minAge, maxAge, 'age');
}

function setupPreviousPlayersFilter() {
  const playerCounts = {};
  allGames.forEach(game => {
    game.previous_players.forEach(player => {
      playerCounts[player] = (playerCounts[player] || 0) + 1;
    });
  });

  const sortedPlayers = Object.keys(playerCounts).sort();
  const items = sortedPlayers.map(player => ({
    label: player,
    value: player,
    count: playerCounts[player]
  }));

  // Only create the filter if there are previous players
  if (items.length > 0) {
    createRefinementFilter('facet-previous-players', 'Previous players', items, 'previous_players');
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-previous-players');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupNumPlaysFilter() {
  const playRanges = [{
    label: 'Any',
    min: 0,
    max: 9999,
    default: true
  }, {
    label: 'Unplayed (0)',
    min: 0,
    max: 0
  }, {
    label: '1-5 plays',
    min: 1,
    max: 5
  }, {
    label: '6-10 plays',
    min: 6,
    max: 10
  }, {
    label: '11+ plays',
    min: 11,
    max: 9999
  }];

  const items = playRanges.map(range => {
    const count = allGames.filter(game => {
      if (range.default) return true;
      return game.numplays >= range.min && game.numplays <= range.max;
    }).length;
    return {
      ...range,
      count: range.default ? allGames.length : count
    };
  });

  createRefinementFilter('facet-numplays', 'Number of plays', items, 'numplays', true);
}

function setupPublisherFilter() {
  const publisherCounts = {};
  allGames.forEach(game => {
    game.publishers.forEach(pub => {
      publisherCounts[pub.name] = (publisherCounts[pub.name] || 0) + 1;
    });
  });

  const sortedPublishers = Object.keys(publisherCounts).sort();
  // This lets you sort the publishers by count, but it's difficult to use without search
  // const entries = Object.entries(publisherCounts);
  // const sortedEntries = entries.sort((a, b) => { return b[1] - a[1]; });
  // const sortedPublishers = sortedEntries.map(entry => entry[0]);
  const items = sortedPublishers.map(pub => ({
    label: pub,
    value: pub,
    count: publisherCounts[pub]
  }));

  // Only create the filter if there are publishers
  if (items.length > 0) {
    createRefinementFilter('facet-publishers', 'Publishers', items, 'publishers', false, true );
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-publishers');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupDesignerFilter() {
  const designerCounts = {};
  allGames.forEach(game => {
    game.designers.forEach(des => {
      designerCounts[des.name] = (designerCounts[des.name] || 0) + 1;
    });
  });

  const sortedDesigners = Object.keys(designerCounts).sort();
  const items = sortedDesigners.map(des => ({
    label: des,
    value: des,
    count: designerCounts[des]
  }));

  // Only create the filter if there are publishers
  if (items.length > 0) {
    createRefinementFilter('facet-designers', 'Designers', items, 'designers', false, true );
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-designers');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupArtistFilter() {
  const artistCounts = {};
  allGames.forEach(game => {
    game.artists.forEach(art => {
      artistCounts[art.name] = (artistCounts[art.name] || 0) + 1;
    });
  });

  const sortedArtists = Object.keys(artistCounts).sort();
  const items = sortedArtists.map(art => ({
    label: art,
    value: art,
    count: artistCounts[art]
  }));

  // Only create the filter if there are artists
  if (items.length > 0) {
    createRefinementFilter('facet-artists', 'Artists', items, 'artists', false, true );
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-artists');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupYearFilter() {
  const yearCounts = {};
  allGames.forEach(game => {
    if (game.year) {
      yearCounts[game.year] = (yearCounts[game.year] || 0) + 1;
    }
  });

  const sortedYears = Object.keys(yearCounts).sort();
  sortedYears.reverse();
  const items = sortedYears.map(yr => ({
    label: yr,
    value: yr,
    count: yearCounts[yr]
  }));

  // Check if all items have zero count (effectively empty filter)
  const hasAnyItems = items.some(item => item.count > 0);
  if (hasAnyItems) {
    createRefinementFilter('facet-years', 'Year', items, 'years');
  } else {
    // Hide the filter container if no items have counts
    const container = document.getElementById('facet-years');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupStatusFilter() {
  const statusCounts = {};
  allGames.forEach(game => {
    game.tags.forEach(stat => {
      statusCounts[stat] = (statusCounts[stat] || 0) + 1;
    });
  });

  const sortedStatus = Object.keys(statusCounts).sort();
  const items = sortedStatus.map(stat => ({
    label: stat,
    value: stat,
    count: statusCounts[stat]
  }));

  // Only create the filter if there are status
  if (items.length > 0) {
    createRefinementFilter('facet-status', 'Status', items, 'status');
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-status');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupWishlistFilter() {
  const wishlistCounts = {};
  allGames.forEach(game => {
    if (game.wishlist_priority) {
      wishlistCounts[game.wishlist_priority] = (wishlistCounts[game.wishlist_priority] || 0) + 1;
    }
  });

  const items = CONFIG.WISHLIST_NAMES.map(wl => ({
    label: wl,
    value: wl,
    count: wishlistCounts[wl]
  }));

  // Only create the filter if there are wishlist levels
  if (items.length > 0) {
    createRefinementFilter('facet-wishlist', 'Wishlist', items, 'wishlist');
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-wishlist');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function createSliderRefinementFilter(facetId, title, min, max) {
  const container = document.getElementById(facetId);
  if (!container) return;

  const template = document.getElementById('slider-refinement-template');
  if (!template) {
      console.error('Slider refinement template not found!');
      return;
  }

  const sliderDropdown = template.content.cloneNode(true);

  const dropdown = sliderDropdown.querySelector('details');
  dropdown.id = facetId;

  // Store the initial min and max values in custom data attributes
  dropdown.setAttribute('data-min', min);
  dropdown.setAttribute('data-max', max);

  const dropdownTitle = sliderDropdown.querySelector('.filter-title');
  dropdownTitle.textContent = title;

  const minLabel = sliderDropdown.querySelector('.slider-min-label');
  const maxLabel = sliderDropdown.querySelector('.slider-max-label');
  const minHandle = sliderDropdown.querySelector('.slider-min');
  const maxHandle = sliderDropdown.querySelector('.slider-max');
  const sliderTrack = sliderDropdown.querySelector('.slider-track');

  // Create a range highlight element
  const rangeHighlight = document.createElement('div');
  rangeHighlight.className = 'slider-range-highlight';
  sliderTrack.appendChild(rangeHighlight); // Add the range highlight to the track

  // **Step 1: Explicitly set initial handle positions**
  minHandle.style.left = '0%';
  maxHandle.style.left = '100%';

  // **Step 2: Directly set initial label values (independent of calculations)**
  minLabel.textContent = min; // Set the minimum value directly
  maxLabel.textContent = max; // Set the maximum value directly

  // **Step 3: Explicitly set initial label positions**
  minLabel.style.left = '0%';
  maxLabel.style.left = '100%';

  // **Step 4: Initialize the range highlight (only after handles are set)**
  function updateRangeHighlight() {
      const minPercentage = parseFloat(minHandle.style.left) || 0;
      const maxPercentage = parseFloat(maxHandle.style.left) || 100;

      // Ensure valid percentages before updating
      if (minPercentage >= 0 && maxPercentage <= 100) {
          rangeHighlight.style.left = `${minPercentage}%`;
          rangeHighlight.style.width = `${maxPercentage - minPercentage}%`;
      }
  }

  // **Step 5: Align labels with handles and update highlight**
  function initializeLabelPositions() {
      // Align labels with handle positions
      minLabel.style.left = minHandle.style.left;
      maxLabel.style.left = maxHandle.style.left;

      // Update the range highlight after initialization
      updateRangeHighlight();
  }

  initializeLabelPositions(); // Initialize positions when the slider loads

  function handleDrag(handle, event) {
      const sliderRect = sliderTrack.getBoundingClientRect();
      const sliderWidth = sliderRect.width;

      const updatePosition = (e) => {
          const mouseX = e.clientX - sliderRect.left;
          const percentage = Math.min(Math.max((mouseX / sliderWidth) * 100, 0), 100);

          if (handle === minHandle) {
              const maxPercentage = parseFloat(maxHandle.style.left);
              if (percentage < maxPercentage) {
                  minHandle.style.left = `${percentage}%`;
                  minLabel.style.left = `${percentage}%`;
                  minLabel.textContent = Math.round(min + (percentage / 100) * (max - min));
              }
          } else if (handle === maxHandle) {
              const minPercentage = parseFloat(minHandle.style.left);
              if (percentage > minPercentage) {
                  maxHandle.style.left = `${percentage}%`;
                  maxLabel.style.left = `${percentage}%`;
                  maxLabel.textContent = Math.round(min + (percentage / 100) * (max - min));
              }
          }

          updateRangeHighlight(); // Update the range highlight dynamically
          onFilterChange();
      };

      const stopDrag = () => {
          document.removeEventListener('mousemove', updatePosition);
          document.removeEventListener('mouseup', stopDrag);
      };

      document.addEventListener('mousemove', updatePosition);
      document.addEventListener('mouseup', stopDrag);
  }

  minHandle.addEventListener('mousedown', (event) => handleDrag(minHandle, event));
  maxHandle.addEventListener('mousedown', (event) => handleDrag(maxHandle, event));

  container.replaceWith(dropdown);
}

function createRefinementFilter(facetId, title, items, attributeName, isRadio = false, enableSearch = false) {
  const container = document.getElementById(facetId);
  if (!container) return;

  // Create filter dropdown structure manually
  const template = document.getElementById('filter-item-template');
  const dropdownTemplate = document.getElementById('filter-dropdown-template');

  // Function to create HTML for filter items
  const createFilterItemsHtml = (items) => {
    return items
      .filter(item => {
        // Exclude items with count === 0
        const count = (typeof item === 'object' && item.count !== undefined) ? item.count : null;
        return count !== 0; // Filter out items with count === 0
      })
      .map(item => {
        const value = (typeof item === 'object' && item.value !== undefined) ? item.value : (typeof item === 'object' && item.min !== undefined ? `${item.min}-${item.max}` : item);
        const label = (typeof item === 'object' && item.label !== undefined) ? item.label : item;
        const count = (typeof item === 'object' && item.count !== undefined) ? item.count : null;
        const checked = (isRadio && typeof item === 'object' && item.default) ? 'checked' : '';
        const inputType = isRadio ? 'radio' : 'checkbox';
        const level = (typeof item === 'object' && item.level !== undefined) ? item.level : 0;
        const parentValue = (typeof item === 'object' && item.parentValue !== undefined) ? item.parentValue : '';

        const clone = template.content.cloneNode(true);
        const labelEl = clone.querySelector('.filter-item');
        const input = clone.querySelector('input');
        const span = clone.querySelector('.filter-label');
        const countEl = clone.querySelector('.facet-count');

        input.type = inputType;
        input.name = attributeName;
        input.value = value;
        if (checked) input.checked = true;
        span.textContent = label;

        // Add level and parent attributes for hierarchical structure
        if (level > 0) {
          labelEl.setAttribute('data-level', level);
          labelEl.setAttribute('data-parent-value', parentValue);
          labelEl.style.display = 'none'; // Initially hide sub-options
          labelEl.style.paddingLeft = '20px'; // Indent sub-options
        }

        if (count !== null) {
          countEl.textContent = count;
          countEl.style.display = 'inline';
        } else {
          countEl.style.display = 'none';
        }

        return labelEl.outerHTML;
      })
      .join('');
  };

  const filterItemsHtml = createFilterItemsHtml(items);

  const clone = dropdownTemplate.content.cloneNode(true);
  const details = clone.querySelector('details');
  details.id = facetId;
  clone.querySelector('.filter-title').textContent = title;

  // Add search box only if `enableSearch` is true
  const searchBoxId = `${facetId}-search`; // Dynamic ID based on facetId
  const clearButtonId = `${facetId}-clear`; // Dynamic ID for the clear button
  const searchBoxHtml = enableSearch
    ? `
      <div style="position: relative; width: 100%; margin-bottom: 10px;">
        <input type="text" id="${searchBoxId}" class="filter-search" placeholder="Search..." style="width: 100%; padding: 5px; box-sizing: border-box;">
        <span id="${clearButtonId}" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; font-size: 16px;">&times;</span>
      </div>
    `
    : '';

  clone.querySelector('.filter-dropdown-content').innerHTML = searchBoxHtml + filterItemsHtml;
  container.replaceWith(clone);

  const newContainer = document.getElementById(facetId);
  if (newContainer) {
    if (newContainer.tagName === 'DETAILS') {
      newContainer.open = false;
    }

    // Function to refresh visible items
    const refreshVisibleItems = () => {
      const filterItems = Array.from(newContainer.querySelectorAll('.filter-item'));
      const searchBox = enableSearch ? document.getElementById(searchBoxId) : null;
      const searchText = searchBox ? searchBox.value.toLowerCase() : '';

      filterItems.forEach(item => {
        const input = item.querySelector('input');
        const labelText = item.querySelector('.filter-label').textContent.toLowerCase();
        const count = item.querySelector('.facet-count').textContent;

        // Exclude items with count === 0 dynamically
        if (count === '0') {
          item.style.display = 'none';
          return;
        }

        // Show items based on search text or selection
        if (input.checked || !enableSearch || labelText.includes(searchText)) {
          item.style.display = 'flex';
        } else {
          item.style.display = 'none';
        }
      });

      // Reapply event listeners to all visible inputs
      const visibleInputs = Array.from(newContainer.querySelectorAll('.filter-item input')).filter(input => input.closest('.filter-item').style.display !== 'none');
      visibleInputs.forEach(input => {
        input.removeEventListener('change', onFilterChange); // Remove any existing listener to avoid duplicates
        input.addEventListener('change', (event) => {
          onFilterChange(); // Call the external filter change handler
          refreshVisibleItems(); // Refresh items to update visibility
        });
      });
    };

    // Add event listener for search box if enabled
    if (enableSearch) {
      const searchBox = document.getElementById(searchBoxId); // Access search box by dynamic ID
      const clearButton = document.getElementById(clearButtonId); // Access clear button by dynamic ID

      searchBox.addEventListener('click', (event) => {
        event.stopPropagation(); // Stop the click event from propagating to the <details> element
      });

      searchBox.addEventListener('input', refreshVisibleItems);

      // Clear button functionality
      clearButton.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent dropdown menu from closing
        searchBox.value = ''; // Clear the search box
        refreshVisibleItems(); // Refresh the dropdown to show all items
      });
    }

    // Reapply filters when dropdown is reopened
    newContainer.addEventListener('toggle', function () {
      if (this.open) {
        refreshVisibleItems();
      }
    });

    // Initial setup for visible items
    refreshVisibleItems();
  }
}

function updateClearButtonVisibility(filters) {
  const clearContainer = document.getElementById('clear-all');
  if (!clearContainer) return;

  const {
    query,
    selectedCategories,
    selectedMechanics,
    selectedPlayerFilter,
    selectedWeight,
    selectedPlayingTime,
    selectedPreviousPlayers,
    selectedMinAge,
    selectedNumPlays,
    selectedPublishers,
    selectedDesigners,
    selectedArtists,
    selectedYears,
    selectedStatus,
    selectedWishlist,
    selectedAgeRange
  } = filters;

  const ageSlider = getSelectedSlider('facet-age-range');

  const isAnyFilterActive =
    (query && query !== '') ||
    (selectedCategories && selectedCategories.length > 0) ||
    (selectedMechanics && selectedMechanics.length > 0) ||
    (selectedPlayerFilter && selectedPlayerFilter !== 'any') ||
    (selectedWeight && selectedWeight.length > 0) ||
    (selectedPlayingTime && selectedPlayingTime.length > 0) ||
    (selectedPreviousPlayers && selectedPreviousPlayers.length > 0) ||
    selectedMinAge !== null ||
    selectedNumPlays !== null ||
    (selectedPublishers && selectedPublishers.length > 0) ||
    (selectedDesigners && selectedDesigners.length > 0) ||
    (selectedArtists && selectedArtists.length > 0) ||
    (selectedYears && selectedYears.length > 0) ||
    (selectedStatus && selectedStatus.length > 0) ||
    (selectedWishlist && selectedWishlist.length > 0) ||
    (selectedAgeRange && selectedAgeRange.min > ageSlider.min_init) ||
    (selectedAgeRange && selectedAgeRange.max < ageSlider.max_init);

  clearContainer.style.display = isAnyFilterActive ? 'flex' : 'none';
}

function updateFilterActiveStates(filters) {
  // Update categories filter
  const categoriesFilter = document.getElementById('facet-categories');
  if (categoriesFilter) {
    if (filters.selectedCategories && filters.selectedCategories.length > 0) {
      categoriesFilter.classList.add('filter-active');
    } else {
      categoriesFilter.classList.remove('filter-active');
    }
  }

  // Update mechanics filter
  const mechanicsFilter = document.getElementById('facet-mechanics');
  if (mechanicsFilter) {
    if (filters.selectedMechanics && filters.selectedMechanics.length > 0) {
      mechanicsFilter.classList.add('filter-active');
    } else {
      mechanicsFilter.classList.remove('filter-active');
    }
  }

  // Update players filter
  const playersFilter = document.getElementById('facet-players');
  if (playersFilter) {
    if (filters.selectedPlayerFilter && filters.selectedPlayerFilter !== 'any') {
      playersFilter.classList.add('filter-active');
    } else {
      playersFilter.classList.remove('filter-active');
    }
  }

  // Update weight filter
  const weightFilter = document.getElementById('facet-weight');
  if (weightFilter) {
    if (filters.selectedWeight && filters.selectedWeight.length > 0) {
      weightFilter.classList.add('filter-active');
    } else {
      weightFilter.classList.remove('filter-active');
    }
  }

  // Update playing time filter
  const playingTimeFilter = document.getElementById('facet-playing-time');
  if (playingTimeFilter) {
    if (filters.selectedPlayingTime && filters.selectedPlayingTime.length > 0) {
      playingTimeFilter.classList.add('filter-active');
    } else {
      playingTimeFilter.classList.remove('filter-active');
    }
  }

  // Update min age filter
  const minAgeFilter = document.getElementById('facet-min-age');
  if (minAgeFilter) {
    if (filters.selectedMinAge !== null) {
      minAgeFilter.classList.add('filter-active');
    } else {
      minAgeFilter.classList.remove('filter-active');
    }
  }

  // Update previous players filter
  const prevPlayersFilter = document.getElementById('facet-previous-players');
  if (prevPlayersFilter) {
    if (filters.selectedPreviousPlayers && filters.selectedPreviousPlayers.length > 0) {
      prevPlayersFilter.classList.add('filter-active');
    } else {
      prevPlayersFilter.classList.remove('filter-active');
    }
  }

  // Update number of plays filter
  const numPlaysFilter = document.getElementById('facet-numplays');
  if (numPlaysFilter) {
    if (filters.selectedNumPlays !== null) {
      numPlaysFilter.classList.add('filter-active');
    } else {
      numPlaysFilter.classList.remove('filter-active');
    }
  }

  // Update publishers filter
  const publishersFilter = document.getElementById('facet-publishers');
  if (publishersFilter) {
    if (filters.selectedPublishers && filters.selectedPublishers.length > 0) {
      publishersFilter.classList.add('filter-active');
    } else {
      publishersFilter.classList.remove('filter-active');
    }
  }

    // Update designers filter
    const designersFilters = document.getElementById('facet-designers');
    if (designersFilters) {
      if (filters.selectedDesigners && filters.selectedDesigners.length > 0) {
        designersFilters.classList.add('filter-active');
      } else {
        designersFilters.classList.remove('filter-active');
      }
    }

    // Update artists filter
    const artistsFilters = document.getElementById('facet-artists');
    if (artistsFilters) {
      if (filters.selectedArtists && filters.selectedArtists.length > 0) {
        artistsFilters.classList.add('filter-active');
      } else {
        artistsFilters.classList.remove('filter-active');
      }
    }

    // Update year filter
    const yearsFilters = document.getElementById('facet-years');
    if (yearsFilters) {
      if (filters.selectedYears && filters.selectedYears.length > 0) {
        yearsFilters.classList.add('filter-active');
      } else {
        yearsFilters.classList.remove('filter-active');
      }
    }

    // Update status filter
    const statusFilters = document.getElementById('facet-status');
    if (statusFilters) {
      if (filters.selectedStatus && filters.selectedStatus.length > 0) {
        statusFilters.classList.add('filter-active');
      } else {
        statusFilters.classList.remove('filter-active');
      }
    }

    // Update wishlist priority filter
    const wishlistFilters = document.getElementById('facet-wishlist');
    if (wishlistFilters) {
      if (filters.selectedWishlist && filters.selectedWishlist.length > 0) {
        wishlistFilters.classList.add('filter-active');
      } else {
        wishlistFilters.classList.remove('filter-active');
      }
    }

    // Update age range priority filter
    const ageRangeFilters = document.getElementById('facet-age-range');
    const ageSlider = getSelectedSlider('facet-age-range');

    if (ageRangeFilters) {
      if (filters.selectedAgeRange && (filters.selectedAgeRange.min > ageSlider.min_init || filters.selectedAgeRange.max < ageSlider.max_init)) {
        ageRangeFilters.classList.add('filter-active');
      } else {
        ageRangeFilters.classList.remove('filter-active');
      }
    }
}

function getFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  const minAgeParam = params.get('min_age');
  const numPlaysParam = params.get('numplays');
  const ageRangeParam = params.get('age');

  return {
    query: params.get('q') || '',
    selectedCategories: params.get('categories')?.split(',').filter(Boolean) || [],
    selectedMechanics: params.get('mechanics')?.split(',').filter(Boolean) || [],
    selectedPlayerFilter: params.get('players') || 'any',
    selectedWeight: params.get('weight')?.split(',').filter(Boolean) || [],
    selectedPlayingTime: params.get('playing_time')?.split(',').filter(Boolean) || [],
    selectedPreviousPlayers: params.get('previous_players')?.split(',').filter(Boolean) || [],
    selectedMinAge: minAgeParam ? { min: Number(minAgeParam.split('-')[0]), max: Number(minAgeParam.split('-')[1]) } : null,
    selectedNumPlays: numPlaysParam ? { min: Number(numPlaysParam.split('-')[0]), max: Number(numPlaysParam.split('-')[1]) } : null,
    selectedPublishers: params.get('publishers')?.split(',').filter(Boolean) || [],
    selectedDesigners: params.get('designers')?.split(',').filter(Boolean) || [],
    selectedArtists: params.get('artists')?.split(',').filter(Boolean) || [],
    selectedYears: params.get('years')?.split(',').filter(Boolean) || [],
    selectedStatus: params.get('status')?.split(',').filter(Boolean) || [],
    selectedWishlist: params.get('wishlist')?.split(',').filter(Boolean) || [],
    selectedAge: [], // ageRangeParam ? { min: Number(minAgeParam.split('-')[0]), max: Number(minAgeParam.split('-')[1]) } : null,
    sortBy: params.get('sort') || 'name',
    page: Number(params.get('page')) || 1
  };
}

function getFiltersFromUI() {
  const query = document.getElementById('search-input')?.value.toLowerCase().trim() || '';
  const selectedCategories = getSelectedValues('categories');
  const selectedMechanics = getSelectedValues('mechanics');
  const selectedPlayerFilter = document.querySelector('input[name="players"]:checked')?.value || 'any';
  const selectedWeight = getSelectedValues('weight');
  const selectedPlayingTime = getSelectedValues('playing_time');
  const selectedPreviousPlayers = getSelectedValues('previous_players');
  const selectedMinAge = getSelectedRange('min_age');
  const selectedNumPlays = getSelectedRange('numplays');
  const selectedPublishers = getSelectedValues('publishers');
  const selectedDesigners = getSelectedValues('designers');
  const selectedArtists = getSelectedValues('artists');
  const selectedYears = getSelectedValues('years');
  const selectedStatus = getSelectedValues('status');
  const selectedWishlist = getSelectedValues('wishlist');
  const selectedAgeRange = getSelectedSlider('facet-age-range');
  const sortBy = document.getElementById('sort-select')?.value || 'name';

  return {
    query,
    selectedCategories,
    selectedMechanics,
    selectedPlayerFilter,
    selectedWeight,
    selectedPlayingTime,
    selectedPreviousPlayers,
    selectedMinAge,
    selectedNumPlays,
    selectedPublishers,
    selectedDesigners,
    selectedArtists,
    selectedYears,
    selectedStatus,
    selectedWishlist,
    selectedAgeRange,
    sortBy,
    page: currentPage
  };
}

function updateURLWithFilters(filters) {
  const params = new URLSearchParams();

  if (filters.query) params.set('q', filters.query);
  if (filters.selectedCategories?.length) params.set('categories', filters.selectedCategories.join(','));
  if (filters.selectedMechanics?.length) params.set('mechanics', filters.selectedMechanics.join(','));
  if (filters.selectedPlayerFilter && filters.selectedPlayerFilter !== 'any') params.set('players', filters.selectedPlayerFilter);
  if (filters.selectedWeight?.length) params.set('weight', filters.selectedWeight.join(','));
  if (filters.selectedPlayingTime?.length) params.set('playing_time', filters.selectedPlayingTime.join(','));
  if (filters.selectedPreviousPlayers?.length) params.set('previous_players', filters.selectedPreviousPlayers.join(','));
  if (filters.selectedMinAge) params.set('min_age', `${filters.selectedMinAge.min}-${filters.selectedMinAge.max}`);
  if (filters.selectedNumPlays) params.set('numplays', `${filters.selectedNumPlays.min}-${filters.selectedNumPlays.max}`);
  if (filters.selectedPublishers?.length) params.set('publishers', filters.selectedPublishers.join(','));
  if (filters.selectedDesigners?.length) params.set('designers', filters.selectedDesigners.join(','));
  if (filters.selectedArtists?.length) params.set('artists', filters.selectedArtists.join(','));
  if (filters.selectedYears?.length) params.set('year', filters.selectedYears.join(','));
  if (filters.selectedStatus?.length) params.set('status', filters.selectedStatus.join(','));
  if (filters.selectedWishlist?.length) params.set('wishlist', filters.selectedWishlist.join(','));
  if (filters.selectedAgeRange) params.set('age', `${filters.selectedAgeRange.min}-${filters.selectedAgeRange.max}`);
  if (filters.sortBy && filters.sortBy !== 'name') params.set('sort', filters.sortBy);
  if (filters.page && filters.page > 1) params.set('page', filters.page);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  history.replaceState(filters, '', newUrl);
}

function updateUIFromState(state) {
  document.getElementById('search-input').value = state.query;

  document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);

  const checkboxFilters = {
    'categories': state.selectedCategories,
    'mechanics': state.selectedMechanics,
    'weight': state.selectedWeight,
    'playing_time': state.selectedPlayingTime,
    'previous_players': state.selectedPreviousPlayers,
    'publishers': state.selectedPublishers,
    'artists': state.selectedArtists,
    'designers': state.selectedDesigners,
    'years': state.selectedYears,
    'status': state.selectedStatus,
    'wishlist': state.selectedWishlist
  };

  for (const name in checkboxFilters) {
    const values = checkboxFilters[name];
    if (values?.length) {
      values.forEach(value => {
        const cb = document.querySelector(`input[type="checkbox"][name="${name}"][value="${CSS.escape(value)}"]`);
        if (cb) cb.checked = true;
      });
    }
  }

  const playerRadio = document.querySelector(`input[name="players"][value="${state.selectedPlayerFilter}"]`);
  if (playerRadio) playerRadio.checked = true;

  // Always handle player filter sub-options visibility
  const allPlayerLabels = document.querySelectorAll('#facet-players label.filter-item[data-level]');

  if (state.selectedPlayerFilter && state.selectedPlayerFilter !== 'any') {
    if (state.selectedPlayerFilter.includes('-')) {
      // A sub-option is selected - show all sub-options for the same parent
      const parentValue = state.selectedPlayerFilter.split('-')[0];
      allPlayerLabels.forEach(label => {
        const level = parseInt(label.dataset.level, 10);
        if (level > 0) {
          label.style.display = label.dataset.parentValue === parentValue ? 'flex' : 'none';
        }
      });
    } else {
      // A main player count is selected - show its sub-options
      const mainValue = state.selectedPlayerFilter;
      allPlayerLabels.forEach(label => {
        const level = parseInt(label.dataset.level, 10);
        if (level > 0) {
          label.style.display = label.dataset.parentValue === mainValue ? 'flex' : 'none';
        }
      });
    }
  } else {
    // Hide all sub-options when "any" is selected
    allPlayerLabels.forEach(label => {
      const level = parseInt(label.dataset.level, 10);
      if (level > 0) {
        label.style.display = 'none';
      }
    });
  }

  const minAgeValue = state.selectedMinAge ? `${state.selectedMinAge.min}-${state.selectedMinAge.max}` : '0-100';
  const minAgeRadio = document.querySelector(`input[name="min_age"][value="${minAgeValue}"]`);
  if (minAgeRadio) minAgeRadio.checked = true;

  const numPlaysValue = state.selectedNumPlays ? `${state.selectedNumPlays.min}-${state.selectedNumPlays.max}` : '0-9999';
  const numPlaysRadio = document.querySelector(`input[name="numplays"][value="${numPlaysValue}"]`);
  if (numPlaysRadio) numPlaysRadio.checked = true;

  resetSlider('facet-age-range');

  document.getElementById('sort-select').value = state.sortBy;
  currentPage = state.page;
}

function onFilterChange(resetPage = true) {
  const state = getFiltersFromUI();
  if (resetPage) {
    state.page = 1;
    currentPage = 1;
  }
  updateURLWithFilters(state);
  applyFiltersAndSort(state);
  updateResults();
  updateStats();
}

function setupClearAllButton() {
  const clearContainer = document.getElementById('clear-all');
  const button = createElement('button', {
    id: 'clear-filters',
    className: 'clear-button'
  }, 'Clear filters');
  button.addEventListener('click', clearAllFilters);

  clearContainer.appendChild(button);
  clearContainer.style.display = 'none';
}

function filterGames(gamesToFilter, filters) {
  const {
    query,
    selectedCategories,
    selectedMechanics,
    selectedPlayerFilter,
    selectedWeight,
    selectedPlayingTime,
    selectedPreviousPlayers,
    selectedMinAge,
    selectedNumPlays,
    selectedPublishers,
    selectedDesigners,
    selectedArtists,
    selectedYears,
    selectedStatus,
    selectedWishlist,
    selectedAgeRange
  } = filters;

  return gamesToFilter.filter(game => {

    // if (query) {
    //   ftsSearch(query);
    // }

    // TODO Decide if this should look at names (publisher, artist, designer)
    // also this would be great to add Soundex or Tokenized searching (like FTS)
    if (query && !game.name.toLowerCase().includes(query) &&
        !game.description.toLowerCase().includes(query) &&
        game.alternate_names.filter(item =>
          item.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.families.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.contained.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.reimplementedby.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.reimplements.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.integrates.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.expansions.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.wl_exp.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.po_exp.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.accessories.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.wl_acc.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1) &&
        game.po_acc.filter(item =>
          item.name.toLowerCase().indexOf(query.toLowerCase()) === -1)
        ) {
      return false;
    }

    if (selectedCategories.length > 0 &&
      !selectedCategories.some(cat => game.categories.includes(cat))) {
      return false;
    }

    if (selectedMechanics.length > 0 &&
      !selectedMechanics.some(mech => game.mechanics.includes(mech))) {
      return false;
    }

    if (selectedPlayerFilter && selectedPlayerFilter !== 'any') {
      // Handle both simple player count (e.g., "2") and detailed format (e.g., "2-best")
      const filterParts = selectedPlayerFilter.split('-');
      const targetPlayers = Number(filterParts[0]);
      const requiredType = filterParts.length > 1 ? filterParts[1] : null;

      if (!isNaN(targetPlayers)) {
        const match = game.players.some(([count, type]) => {
          if (!count || type === 'not recommended') return false;

          // If a specific recommendation type is required, check for it
          if (requiredType && type !== requiredType) return false;

          const parsed = parsePlayerCount(count);
          if (parsed.open) {
            return targetPlayers === parsed.min;
          }
          return targetPlayers >= parsed.min && targetPlayers <= parsed.max;
        });

        if (!match) {
          return false;
        }
      }
    }

    if (selectedWeight.length > 0) {
      const gameWeightName = getComplexityName(game.weight);
      if (!gameWeightName || !selectedWeight.includes(gameWeightName)) {
        return false;
      }
    }

    if (selectedPlayingTime.length > 0 && !selectedPlayingTime.includes(game.playing_time)) {
      return false;
    }

    if (selectedPreviousPlayers.length > 0 &&
      !selectedPreviousPlayers.some(player => game.previous_players.includes(player))) {
      return false;
    }

    if (selectedMinAge && (game.min_age < selectedMinAge.min || game.min_age > selectedMinAge.max)) {
      return false;
    }

    if (selectedNumPlays && (game.numplays < selectedNumPlays.min || game.numplays > selectedNumPlays.max)) {
      return false;
    }

    if (selectedPublishers.length > 0 &&
      !selectedPublishers.some(pub => game.publishers.find(obj => obj.name === pub))) {
      return false;
    }

    if (selectedDesigners.length > 0 &&
      !selectedDesigners.some(pub => game.designers.find(obj => obj.name === pub))) {
      return false;
    }

    if (selectedArtists.length > 0 &&
      !selectedArtists.some(pub => game.artists.find(obj => obj.name === pub))) {
      return false;
    }

    if (selectedYears.length > 0 &&
      !selectedYears.includes("" + game.year)) {
      return false;
    }

    if (selectedStatus.length > 0 &&
      !selectedStatus.some(stat => game.tags.includes(stat))) {
      return false;
    }

    if (selectedWishlist.length > 0 &&
      !selectedWishlist.some(wl => game.wishlist_priority === wl)) {
      return false;
    }

    if (selectedAgeRange && (game.min_age < selectedAgeRange.min || game.min_age > selectedAgeRange.max)) {
      return false;
    }

    return true;
  });
}

function updateCountsInDOM(facetId, counts, showZero = false) {
  const facetContainer = document.getElementById(facetId);
  if (!facetContainer) return;

  const filterItems = facetContainer.querySelectorAll('.filter-item');
  filterItems.forEach(item => {
    const input = item.querySelector('input');
    if (!input) return;

    const value = input.value;
    const countSpan = item.querySelector('.facet-count');

    if (countSpan) {
      const newCount = counts[value] || 0;
      countSpan.textContent = newCount;

      // Special handling for player filter hierarchical structure
      if (facetId === 'facet-players') {
        const level = parseInt(item.dataset.level, 10) || 0;

        if (level > 0) {
          // This is a sub-option - show if:
          // 1. Its parent is selected, OR
          // 2. Any sub-option with the same parent is selected, OR
          // 3. This specific sub-option is selected
          const parentValue = item.dataset.parentValue;
          const parentInput = facetContainer.querySelector(`input[value="${parentValue}"]`);
          const anyInput = facetContainer.querySelector(`input[value="any"]`);

          // Check if any sub-option with the same parent is selected
          const anySubOptionSelected = Array.from(facetContainer.querySelectorAll(`input[type="radio"]`))
            .some(radio => radio.checked && radio.value.includes('-') && radio.value.startsWith(parentValue + '-'));

          // Sub-options should be visible if:
          // 1. Their specific parent is selected, OR
          // 2. Any sub-option for this parent is selected
          // AND "Any" is NOT selected
          const shouldShow = ((parentInput && parentInput.checked) || anySubOptionSelected) && !(anyInput && anyInput.checked);

          item.style.display = shouldShow ? 'flex' : 'none';
        } else {
          // This is a main option - show/hide based on count
          if (newCount === 0 && !input.checked && !showZero) {
            item.style.display = 'none';
          } else {
            item.style.display = 'flex';
          }
        }
      } else {
        // Normal handling for other filters
        if (newCount === 0 && !input.checked && !showZero) {
          item.style.display = 'none';
        } else {
          item.style.display = 'flex';
        }
      }
    }
  });
}

function updateAllFilterCounts(filters) {
  const catFilters = {
    ...filters,
    selectedCategories: []
  };
  const gamesForCatCount = filterGames(allGames, catFilters);
  const categoryCounts = {};
  gamesForCatCount.forEach(game => {
    game.categories.forEach(cat => {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-categories', categoryCounts);

  const mechFilters = {
    ...filters,
    selectedMechanics: []
  };
  const gamesForMechCount = filterGames(allGames, mechFilters);
  const mechanicCounts = {};
  gamesForMechCount.forEach(game => {
    game.mechanics.forEach(mech => {
      mechanicCounts[mech] = (mechanicCounts[mech] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-mechanics', mechanicCounts);

  const playerFilters = {
    ...filters,
    selectedPlayerFilter: 'any'
  };
  const gamesForPlayerCount = filterGames(allGames, playerFilters);
  const playerCounts = {};
  document.querySelectorAll('#facet-players input[type="radio"]').forEach(radio => {
    const value = radio.value;
    if (value === 'any') {
      playerCounts[value] = gamesForPlayerCount.length;
    } else {
      const targetPlayers = Number(value);
      const count = gamesForPlayerCount.filter(game =>
        game.players.some(([playerCount, type]) => {
          if (type === 'not recommended') return false;
          const {
            min,
            max
          } = parsePlayerCount(playerCount);
          return targetPlayers >= min && targetPlayers <= max;
        })
      ).length;
      playerCounts[value] = count;
    }
  });
  updateCountsInDOM('facet-players', playerCounts, true);

  const weightFilters = {
    ...filters,
    selectedWeight: []
  };
  const gamesForWeightCount = filterGames(allGames, weightFilters);
  const weightCounts = {};
  gamesForWeightCount.forEach(game => {
    if (game.weight) {
      const name = getComplexityName(game.weight);
      if (name) {
        weightCounts[name] = (weightCounts[name] || 0) + 1;
      }
    }
  });
  updateCountsInDOM('facet-weight', weightCounts);

  const playingTimeFilters = {
    ...filters,
    selectedPlayingTime: []
  };
  const gamesForPlayingTimeCount = filterGames(allGames, playingTimeFilters);
  const playingTimeCounts = {};
  gamesForPlayingTimeCount.forEach(game => {
    if (game.playing_time) {
      playingTimeCounts[game.playing_time] = (playingTimeCounts[game.playing_time] || 0) + 1;
    }
  });
  updateCountsInDOM('facet-playing-time', playingTimeCounts);

  const minAgeFilters = {
    ...filters,
    selectedMinAge: null
  };
  const gamesForMinAgeCount = filterGames(allGames, minAgeFilters);
  const minAgeCounts = {};
  document.querySelectorAll('#facet-min-age input[type="radio"]').forEach(radio => {
    const value = radio.value;
    const [min, max] = value.split('-').map(Number);
    if (value === '0-100') {
      minAgeCounts[value] = gamesForMinAgeCount.length;
    } else {
      const count = gamesForMinAgeCount.filter(game => game.min_age >= min && game.min_age <= max).length;
      minAgeCounts[value] = count;
    }
  });
  updateCountsInDOM('facet-min-age', minAgeCounts, true);

  const prevPlayersFilters = {
    ...filters,
    selectedPreviousPlayers: []
  };
  const gamesForPrevPlayersCount = filterGames(allGames, prevPlayersFilters);
  const prevPlayerCounts = {};
  gamesForPrevPlayersCount.forEach(game => {
    game.previous_players.forEach(player => {
      prevPlayerCounts[player] = (prevPlayerCounts[player] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-previous-players', prevPlayerCounts);

  const numPlaysFilters = {
    ...filters,
    selectedNumPlays: null
  };
  const gamesForNumPlaysCount = filterGames(allGames, numPlaysFilters);
  const numPlaysCounts = {};
  document.querySelectorAll('#facet-numplays input[type="radio"]').forEach(radio => {
    const value = radio.value;
    const [min, max] = value.split('-').map(Number);
    if (value === '0-9999') {
      numPlaysCounts[value] = gamesForNumPlaysCount.length;
    } else {
      const count = gamesForNumPlaysCount.filter(game => game.numplays >= min && game.numplays <= max).length;
      numPlaysCounts[value] = count;
    }
  });
  updateCountsInDOM('facet-numplays', numPlaysCounts, true);

  const publisherFilters = {
    ...filters,
    selectedPublishers: []
  };
  const gamesForPubCount = filterGames(allGames, publisherFilters);
  const publisherCounts = {};
  gamesForPubCount.forEach(game => {
    game.publishers.forEach(pub => {
      publisherCounts[pub.name] = (publisherCounts[pub.name] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-publishers', publisherCounts);

  const designerFilters = {
    ...filters,
    selectedDesigners: []
  };
  const gamesForDesCount = filterGames(allGames, designerFilters);
  const designerCounts = {};
  gamesForDesCount.forEach(game => {
    game.designers.forEach(des => {
      designerCounts[des.name] = (designerCounts[des.name] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-designers', designerCounts);

  const artistFilters = {
    ...filters,
    selectedArtists: []
  };
  const gamesForArtCount = filterGames(allGames, artistFilters);
  const artistCounts = {};
  gamesForArtCount.forEach(game => {
    game.artists.forEach(art => {
      artistCounts[art.name] = (artistCounts[art.name] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-artists', artistCounts);

  const yearFilters = {
    ...filters,
    selectedYears: []
  };
  const gamesForYearCount = filterGames(allGames, yearFilters);
  const yearCounts = {};
  gamesForYearCount.forEach(game => {
    if (game.year) {
      yearCounts[game.year] = (yearCounts[game.year] || 0) + 1;
    }
  });
  updateCountsInDOM('facet-years', yearCounts);

  const statusFilters = {
    ...filters,
    selectedStatus: []
  };
  const gamesForStatusCount = filterGames(allGames, statusFilters);
  const statusCounts = {};
  gamesForStatusCount.forEach(game => {
    if (game.tags) {
      statusCounts[game.tags] = (statusCounts[game.tags] || 0) + 1;
    }
  });
  updateCountsInDOM('facet-status', statusCounts);

  const wishlistFilters = {
    ...filters,
    selectedWishlist: []
  };
  const gamesForWLCount = filterGames(allGames, wishlistFilters);
  const wishlistCounts = {};
  gamesForWLCount.forEach(game => {
    if (game.wishlist_priority) {
      wishlistCounts[game.wishlist_priority] = (wishlistCounts[game.wishlist_priority] || 0) + 1;
    }
  });
  updateCountsInDOM('facet-wishlist', wishlistCounts);

  const ageRangeFilters = {
    ...filters,
    selectedAgeRange: null
  };
  const gamesForAgeRangeCount = filterGames(allGames, ageRangeFilters);
  const ageCounts = {};
  const sliderValues = getSelectedSlider('facet-age-range');
  const count = 0;
  if (sliderValues) {
    const count = gamesForAgeRangeCount.filter(game => game.min_age >= sliderValues.min && game.min_age <= sliderValues.max).length;
  }
  ageCounts['range'] = count;
  updateCountsInDOM('facet-age-range', ageCounts, true);

}

function applyFiltersAndSort(filters) {
  updateClearButtonVisibility(filters);
  updateFilterActiveStates(filters);
  updateAllFilterCounts(filters);

  filteredGames = filterGames(allGames, filters);

  filteredGames.sort((a, b) => {
    switch (filters.sortBy) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'rank':
        return (a.rank || 999999) - (b.rank || 999999);
      case 'rating':
        return (b.rating || 0) - (a.rating || 0);
      case 'numowned':
        return (b.numowned || 0) - (a.numowned || 0);
      case 'numrated':
        return (b.usersrated || 0) - (a.usersrated || 0);
      case 'lastmod':
        return (b.last_modified || 0) - (a.last_modified || 0);
      default:
        return 0;
    }
  });
}

function getSelectedValues(name) {
  const checkboxes = document.querySelectorAll(`input[name="${name}"]:checked`);
  return Array.from(checkboxes).map(cb => cb.value);
}

function getSelectedRange(name) {
  const radio = document.querySelector(`input[name="${name}"]:checked`);
  if (!radio || radio.value === '0-100' || radio.value === '0-9999') return null;

  const [min, max] = radio.value.split('-').map(Number);
  return { min, max };
}

function getSelectedSlider(sliderId) {
  // Find the slider container using the sliderId
  const sliderDropdown = document.getElementById(sliderId);
  if (!sliderDropdown) {
      console.error('Slider not found! ' + sliderId);
      return null;
  }

  // Query the labels for min and max values
  const minLabel = sliderDropdown.querySelector('.slider-min-label');
  const maxLabel = sliderDropdown.querySelector('.slider-max-label');


  // Retrieve the initial min and max values from data attributes
  const minData = parseInt(sliderDropdown.getAttribute('data-min'), 10);
  const maxData = parseInt(sliderDropdown.getAttribute('data-max'), 10);

  // Parse the values from the labels
  const minValue = parseInt(minLabel.textContent, 10);
  const maxValue = parseInt(maxLabel.textContent, 10);

  if (minValue == minData && maxValue === maxData) {
    return null;
  }

  return { min: minValue, max: maxValue, min_init: minData, max_init: maxData };
}

function clearAllFilters() {
  history.pushState({}, '', window.location.pathname);
  const state = getFiltersFromURL();
  updateUIFromState(state);
  applyFiltersAndSort(state);
  updateResults();
  updateStats();
}

function updateResults() {
  const container = document.getElementById('hits');
  const startIdx = (currentPage - 1) * GAMES_PER_PAGE;
  const endIdx = startIdx + GAMES_PER_PAGE;
  const pageGames = filteredGames.slice(startIdx, endIdx);

  if (pageGames.length === 0) {
    const template = document.getElementById('no-results-template');
    const clone = template.content.cloneNode(true);
    container.innerHTML = '';
    container.appendChild(clone);
    updatePagination();
    return;
  }

  const gridTemplate = document.getElementById('game-grid-template');
  const gridClone = gridTemplate.content.cloneNode(true);
  const gameGrid = gridClone.querySelector('.game-grid');

  pageGames.forEach(game => {
    gameGrid.appendChild(renderGameCard(game));
  });

  container.innerHTML = '';
  container.appendChild(gridClone);

  on_render();
  updatePagination();
}

/**
 * Unified function to render chips with optional hover functionality and dynamic visibility.
 * @param {Array} items - Array of objects containing `id`, `name`, and optionally `image`
 * @param {HTMLElement} sectionHeading - The subsection heading element (e.g., h3 heading)
 * @param {HTMLElement} container - The container element where chips will be rendered
 * @param {HTMLTemplateElement | String} template - Either a `<template>` element to clone or `chip` for simple links
 * @param {Boolean} [hover=false] - Whether the chips should show images on hover
 * @param {String} [chipClass=""] - Additional class for custom styling (e.g., "wl-accessory-chip")
 */
function renderChips(items, sectionHeading, container, template, hover = false, chipClass = "") {
  if (items && items.length > 0) {
    sectionHeading.style.display = "block"; // Make subsection heading visible if items exist

    items.forEach((item) => {
      let chip;

      // Create chip directly if template is "chip", otherwise clone template
      if (typeof template === "string" && template === "chip") {
        chip = document.createElement("a");
        chip.className = `chip ${chipClass}`; // Apply additional class for styling
      } else {
        const chipClone = template.content.cloneNode(true);
        chip = chipClone.querySelector(".expansion-chip");
        if (chipClass) chip.classList.add(chipClass); // Add extra class
      }

      // Set chip properties dynamically
      chip.href = item.image
        ? `https://boardgamegeek.com/boardgameaccessory/${item.id}`
        : `https://boardgamegeek.com/boardgame/${item.id}`;
      chip.textContent = item.name;

      if (hover && item.image) {
          chip.addEventListener("mouseenter", () => {
              if (!hoverWrapper) {
                  hoverWrapper = document.createElement("div");
                  hoverWrapper.style.position = "absolute";
                  hoverWrapper.style.zIndex = "1000";
                  hoverWrapper.style.pointerEvents = "none";

                  imgPopup = document.createElement("img");
                  imgPopup.src = item.image;
                  imgPopup.alt = item.name;

                  imgPopup.style.width = "auto"; // Maintain width based on aspect ratio
                  imgPopup.style.height = "auto"; // Maintain height based on aspect ratio
                  imgPopup.style.maxWidth = "400px"; // Maximum width relative to viewport
                  imgPopup.style.maxHeight = "500px"; // Maximum height relative to viewport
                  imgPopup.style.borderRadius = "15px"; // Round the corners

                  // Create text overlay
                  const textOverlay = document.createElement("div");

                  // Customize the text that shows on the hover image
                  const ratingValue = Number(item.rating);
                  let overText = `Rating: ${isNaN(ratingValue) ? 'N/A' : ratingValue.toFixed(2)}<br>${item.year}`
                  if (item.wishlist) {
                    if (item.wishlist !== 'Own') {
                      overText += `<br>`
                      if (item.wishlist !== 'Preorder') {
                        overText += `Wishlist: `;
                      }
                      overText += item.wishlist
                    }
                  }
                  textOverlay.innerHTML = overText;

                  textOverlay.style.color = "white";
                  textOverlay.style.position = "absolute";
                  textOverlay.style.top = "10px";
                  textOverlay.style.left = "10px";
                  textOverlay.style.backgroundColor = "rgba(0, 0, 0, 0.7)"; // Semi-transparent background
                  textOverlay.style.padding = "5px";
                  textOverlay.style.borderRadius = "5px";

                  hoverWrapper.appendChild(imgPopup);
                  hoverWrapper.appendChild(textOverlay);
                  document.body.appendChild(hoverWrapper);
              }

              if (imgPopup) {
                // Wait for the image to load to get its height and position
                imgPopup.onload = () => {
                    const chipOffset = 5;

                    // Calculate the position directly above the chip
                    const rect = chip.getBoundingClientRect();
                    const imgHeight = imgPopup.offsetHeight; // Get the height of the hover image
                    let topPosition = window.scrollY + rect.top - imgHeight - chipOffset; // Default position above the chip

                    // Check if the position is above the viewport
                    if (topPosition < 0) {
                        topPosition = window.scrollY + rect.bottom + chipOffset; // Adjust the position below the chip if it goes off the top
                    }

                    // Set final hover wrapper position
                    hoverWrapper.style.top = `${topPosition}px`; // Set position above or below based on the check
                    hoverWrapper.style.left = `${window.scrollX + rect.left}px`; // Align with the left of the chip

                };

                // If the image has already loaded before, we manually call onload to set position
                if (imgPopup.complete) {
                    imgPopup.onload();
                }
              }
          });

          chip.addEventListener("mouseleave", () => {
              if (hoverWrapper) {
                  hoverWrapper.remove();
                  hoverWrapper = null;
                  imgPopup = null;
              }
          });
      }

      container.appendChild(chip); // Append chip to the container
    });
  } else {
    sectionHeading.style.display = "none"; // Hide heading if no items
  }
}

/**
 * Helper function to create hover tooltips for any element.
 * @param {HTMLElement} hoverElement - The element that triggers the tooltip on hover.
 * @param {String} htmlContent - The HTML content that will be displayed in the tooltip.
 * @param {Number} offset - The vertical offset distance between the tooltip and the element.
 */
function createHoverTooltip(hoverElement, htmlContent, offset = 8) {
  // Create the hover tooltip element
  const hoverPopup = document.createElement("div");
  hoverPopup.className = "hover-popup";
  hoverPopup.innerHTML = htmlContent; // Set HTML content dynamically
  hoverPopup.style.position = "absolute";
  hoverPopup.style.backgroundColor = "white";
  hoverPopup.style.border = "1px solid #ddd";
  hoverPopup.style.borderRadius = "5px";
  hoverPopup.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.1)";
  hoverPopup.style.padding = "0.5em";
  hoverPopup.style.fontSize = "0.85em";
  hoverPopup.style.display = "none"; // Initially hidden
  hoverPopup.style.zIndex = "100";
  hoverPopup.style.borderRadius = "5px";

  // Append tooltip to the document body for correct positioning
  document.body.appendChild(hoverPopup);

  // Add hover event listeners for showing and hiding the tooltip
  hoverElement.addEventListener("mouseenter", () => {
    hoverPopup.style.display = "block";

    // Calculate tooltip positioning relative to the hover element
    const rect = hoverElement.getBoundingClientRect();
    const popupWidth = hoverPopup.offsetWidth || 200; // Default width
    const popupHeight = hoverPopup.offsetHeight || 50; // Default height

    // Position tooltip above and centered relative to the hover element
    hoverPopup.style.top = `${rect.top + window.scrollY - popupHeight - offset}px`;
    hoverPopup.style.left = `${rect.left + window.scrollX + rect.width / 2 - popupWidth / 2}px`;
  });

  hoverElement.addEventListener("mouseleave", () => {
    hoverPopup.style.display = "none"; // Hide tooltip when hover ends
  });
}

/**
 * Escapes HTML to prevent injection attacks.
 * @param {String} unsafe - Unescaped string.
 * @returns {String} - Escaped string.
 */
function escapeHtmlChars(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderGameCard(game) {
  const template = document.getElementById('game-card-template');
  const clone = template.content.cloneNode(true);
  const card = clone.querySelector('.game-card');

  // Apply background color based on game status
  if (game.tags.includes("preordered")) {
    card.style.backgroundColor = "rgba(25, 217, 25, 0.15)"; // Light green background for preordered
  } else if (game.tags.includes("wishlist")) {
    card.style.backgroundColor = "rgba(30, 30, 195, 0.15)"; // Light blue background for wishlist
  } else {
    card.style.backgroundColor = "rgba(255, 255, 255, 1)"; // Default white background
  }

  // Additional logic for rendering game cards
  card.setAttribute('data-color', game.color || '255,255,255');
  const summaryImg = clone.querySelector('.game-image');
  const coverImg = clone.querySelector('.cover-image-img');
  summaryImg.src = game.thumbnail ? game.thumbnail : NO_IMAGE_AVAILABLE;
  summaryImg.alt = game.name;
  coverImg.src = game.thumbnail ? game.thumbnail : NO_IMAGE_AVAILABLE;
  coverImg.alt = game.name;

  coverImg.addEventListener("mouseenter", () => {
    // Create a larger image element for hover
    const hoverImg = document.createElement("img");
    hoverImg.src = game.image ? game.image : NO_IMAGE_AVAILABLE;
    hoverImg.alt = "Larger Cover Image";
    hoverImg.style.position = "absolute";
    hoverImg.style.width = "400px"; // Adjust width as needed
    hoverImg.style.height = "auto"; // Maintain aspect ratio
    hoverImg.style.zIndex = "1000";
    hoverImg.style.borderRadius = "15px";

    // Dynamically position the hover image
    const rect = coverImg.getBoundingClientRect();
    hoverImg.style.top = `${window.scrollY + rect.bottom + 10}px`; // Position it below the cover image
    hoverImg.style.left = `${window.scrollX + rect.left}px`;

    hoverImg.id = `hover-cover-img-${game.id}`; // Assign unique ID to avoid overlap
    document.body.appendChild(hoverImg); // Append to body
  });

  coverImg.addEventListener("mouseleave", () => {
    const popupImage = document.getElementById(`hover-cover-img-${game.id}`);
    if (popupImage) popupImage.remove(); // Remove the larger image
  });

  // Set title
  const title = clone.querySelector('.game-title');
  title.innerHTML = highlightText(game.name, getCurrentSearchQuery());

  if (game.version_name) {
    const titleSection = clone.querySelector('.title-section');
    createHoverTooltip(titleSection, game.version_name, 4);
  }

  if ((game.comment && game.comment.trim() !== "") ||
      (game.wishlist_comment && game.wishlist_comment.trim() != "")) {
    const commentSection = clone.querySelector('.comment-section');
    if (commentSection) {
      const commentText = commentSection.querySelector('.comment-text');
      commentText.innerHTML = escapeHtmlChars(game.comment);
      commentText.innerHTML += escapeHtmlChars(game.wishlist_comment);
      commentSection.style.display = "block";
    }
  } else {
    const commentSection = clone.querySelector('.comment-section');
    if (commentSection) {
      commentSection.style.display = "none";
    }
  }

  // Set category chips
  const categoryContainer = clone.querySelector('.category-chips-container');
  const categoryChips = formatCategoryChips(game);
  if (categoryChips) {
    categoryContainer.innerHTML = categoryChips;
  }

  // Set stats bar items
  const playingTimeStat = clone.querySelector('.playing-time-stat');
  if (game.playing_time) {
    playingTimeStat.style.display = 'flex';
    clone.querySelector('.playing-time-value').textContent = game.playing_time;
  }

  const playersStat = clone.querySelector('.players-stat');
  if (game.players.length > 0) {
    playersStat.style.display = "flex";

    // Set concise player count text using formatPlayerCountShort
    const playersValue = clone.querySelector(".players-value");
    playersValue.textContent = formatPlayerCountShort(game.players);

    // Add hover tooltip for players stats using helper function
    createHoverTooltip(playersStat, formatPlayerCount(game.players), 4);
  }

  const complexityStat = clone.querySelector('.complexity-stat');
  if (typeof game.weight === 'number' && !isNaN(game.weight)) {
    complexityStat.style.display = 'flex';
    clone.querySelector('.complexity-gauge-container').innerHTML = renderComplexityGauge(game.weight);
    clone.querySelector('.complexity-name').textContent = getComplexityName(game.weight);

    createHoverTooltip(complexityStat, game.weight.toFixed(2), 4);
  }

  const minAgeStat = clone.querySelector('.min-age-stat');
  if (game.min_age) {
    minAgeStat.style.display = 'flex';
    clone.querySelector('.min-age-value').textContent = game.min_age + "+";

    let hoverText = `<strong>Community Suggested:</strong> ${Math.floor(game.suggested_age)}+`
    if (game.suggested_age === 0) {
      hoverText = "No Community Suggested Age";
    }

    createHoverTooltip(minAgeStat, hoverText, 4);
  }

  const publisherStat = clone.querySelector('.publisher-stat');
  if (game.publishers) {
    let publisherWithFlagOwn = game.publishers.filter(publisher => publisher.flag === "own");
    if (publisherWithFlagOwn && publisherWithFlagOwn.length > 0) {
      publisherStat.style.display = 'flex';
      let pubText = publisherWithFlagOwn.map(p => `${p.name}<br>`).join("");
      createHoverTooltip(publisherStat, pubText, 4);
    }
  }

  const yearStat = clone.querySelector('.year-stat');
  if (game.year) {
    yearStat.style.display = 'flex';
    clone.querySelector('.year-value').textContent = game.year;

    if (game.version_year) {
      let hoverText = `<strong>Version:</strong> ${game.version_year}`

      createHoverTooltip(yearStat, hoverText, 4);
    }
  }

  const statusStat = clone.querySelector('.status-stat');
  statusStat.style.display = 'flex';
  clone.querySelector('.status-value').textContent = game.tags[0];
  if (game.wishlist_priority) {
    createHoverTooltip(statusStat, game.wishlist_priority, 4);
  }

  // Set description
  const teaserText = clone.querySelector('.teaser-text');
  teaserText.setAttribute('data-full-text', escapeHtml(game.description || ''));
  teaserText.innerHTML = game.description ? getTeaserText(game.description, true) : 'No description available.';

  // Set mechanic chips
  const mechanicContainer = clone.querySelector('.mechanic-chips-container');
  const mechanicChips = formatMechanicChips(game);
  if (mechanicChips) {
    const mechanicSection = clone.querySelector(".tags-section");
    mechanicSection.style.display = "block";
    mechanicContainer.innerHTML = mechanicChips;
  }

  // Locate the template for chips
  const expansionChipTemplate = document.getElementById("expansion-chip-template");

  // Check for overall game data
  if (game.expansions.length > 0 || game.po_exp.length > 0 || game.wl_exp.length > 0) {

    // Locate sections and containers in your HTML
    const expansionsSection = clone.querySelector(".expansions-section");
    const originalChipsContainer = clone.querySelector(".original-expansion-chips");
    const poChipsContainer = expansionsSection.querySelector(".po-expansion-chips");
    const wlChipsContainer = expansionsSection.querySelector(".wl-expansion-chips");

    const originalHeading = clone.querySelector("h2");
    const poHeading = expansionsSection.querySelector(".po-expansion-heading");
    const wlHeading = expansionsSection.querySelector(".wl-expansion-heading");

    expansionsSection.style.display = "block"; // Show the section

    // Render expansions with hover functionality
    renderChips(game.expansions, originalHeading, originalChipsContainer, expansionChipTemplate, true);

    // Render preordered expansions with hover functionality and specific style
    renderChips(game.po_exp, poHeading, poChipsContainer, expansionChipTemplate, true, "po-expansion-chip");

    // Render wishlist expansions with hover functionality and specific style
    renderChips(game.wl_exp, wlHeading, wlChipsContainer, expansionChipTemplate, true, "wl-expansion-chip");
  }

  // Dynamic section rendering for Contains
  if (game.contained.length > 0) {
    const containsSection = clone.querySelector('.contains-section');
    const containsHeading = containsSection.querySelector("h2");
    const containsChipsContainer = containsSection.querySelector(".contains-chips");

    containsSection.style.display = "block";
    renderChips(game.contained, containsHeading, containsChipsContainer, expansionChipTemplate, true);
  }

  // Other sections rendered similarly (like Reimplements, Integrates)
  if (game.reimplements.length > 0) {
    const reimplementsSection = clone.querySelector('.reimplements-section');
    const reimplementsHeading = reimplementsSection.querySelector("h2");
    const reimplementsChipsContainer = reimplementsSection.querySelector(".reimplements-chips");

    reimplementsSection.style.display = "block";
    renderChips(game.reimplements, reimplementsHeading, reimplementsChipsContainer, expansionChipTemplate, true);
  }

  if (game.reimplementedby.length > 0) {
    const reimplementedbySection = clone.querySelector('.reimplementedby-section');
    const reimplementedbyHeading = reimplementedbySection.querySelector("h2");
    const reimplementedbyChipsContainer = reimplementedbySection.querySelector(".reimplementedby-chips");

    reimplementedbySection.style.display = "block";
    renderChips(game.reimplementedby, reimplementedbyHeading, reimplementedbyChipsContainer, expansionChipTemplate, true);
  }

  if (game.integrates.length > 0) {
    const integratesSection = clone.querySelector('.integrates-section');
    const integratesHeading = integratesSection.querySelector("h2");
    const integratesChipContainer = integratesSection.querySelector(".integrates-chips");

    integratesSection.style.display = "block";
    renderChips(game.integrates, integratesHeading, integratesChipContainer, expansionChipTemplate, true);
  }

  // Set rating
  const ratingSection = clone.querySelector('.rating-section');
  if (game.rating) {
    ratingSection.style.display = 'flex';
    clone.querySelector('.rating-gauge-container').innerHTML = renderRatingGauge(game.rating);

    createHoverTooltip(
      ratingSection,
      `<strong>Total Users Rated:</strong> ${game.usersrated} users`,
      4);
  }

  // Set rank
  const rankSection = clone.querySelector('.rank-section');
  rankSection.style.display = 'flex';
  if (game.rank) {
    clone.querySelector('.rank-value').textContent = game.rank;

    let hoverText = ""
    if (game.other_ranks && game.other_ranks.length > 0) {
      let rankList = game.other_ranks.map(p => `<li>${p.friendlyname}: ${p.value}</li>`).join("");
      hoverText = `<strong>Other Ranks:</strong><ul>${rankList}</ul>`;

      createHoverTooltip(rankSection, hoverText, 4);
    }
  } else {
    clone.querySelector('.rank-value').textContent = "Unranked";
  }

  // Set number of plays
  const numplaysSection = clone.querySelector('.plays-section');
  clone.querySelector('.numplays-value').textContent = game.numplays || "No";
  if (game.numplays > 0) {
    const DATE_FORMAT = 'MMMM Do, YYYY';
    let played_tooltip = '';
    if (game.first_played !== game.last_played) {
      played_tooltip = `First Played: ${moment(game.first_played).format(DATE_FORMAT)}<br>`
      played_tooltip += `Last Played: ${moment(game.last_played).format(DATE_FORMAT)}`;
    } else {
      played_tooltip = `Played: ${moment(game.last_played).format(DATE_FORMAT)}`
    }

    createHoverTooltip(numplaysSection, played_tooltip, 4);
  }

  // Set BGG link
  const bggLink = clone.querySelector('.bgg-link');
  if (bggLink && game.id) {
    bggLink.href = `https://boardgamegeek.com/boardgame/${game.id}`;
  }

// Check for overall game data
if (game.accessories.length > 0 || game.po_acc.length > 0 || game.wl_acc.length > 0) {

  // Locate sections and containers in your HTML
  const accessoriesSection = clone.querySelector(".accessories-section");
  const originalChipsContainer = clone.querySelector(".original-accessory-chips");
  const poChipsContainer = accessoriesSection.querySelector(".po-accessory-chips");
  const wlChipsContainer = accessoriesSection.querySelector(".wl-accessory-chips");

  const originalAccHeading = accessoriesSection.querySelector("h2");
  const poHeading = accessoriesSection.querySelector(".po-accessory-heading");
  const wlHeading = accessoriesSection.querySelector(".wl-accessory-heading");

  accessoriesSection.style.display = "block"; // Show the section

  // Render expansions with hover functionality
  renderChips(game.accessories, originalAccHeading, originalChipsContainer, "chip", true);

  // Render preordered expansions with hover functionality and specific style
  renderChips(game.po_acc, poHeading, poChipsContainer, "chip", true, "po-accessory-chip");

  // Render wishlist expansions with hover functionality and specific style
  renderChips(game.wl_acc, wlHeading, wlChipsContainer, "chip", true, "wl-accessory-chip");
}

  return clone;
}

function formatCategoryChips(game) {
  if (!game.categories || game.categories.length === 0) {
    return '';
  }
  const template = document.getElementById('category-chip-template');
  const categoriesHtml = game.categories.map(cat => {
    const clone = template.content.cloneNode(true);
    const chip = clone.querySelector('.tag-chip');
    chip.textContent = cat;
    return chip.outerHTML;
  }).join('');
  return createTagChipsContainer(categoriesHtml);
}

function formatMechanicChips(game) {
  if (!game.mechanics || game.mechanics.length === 0) {
    return '';
  }
  const template = document.getElementById('mechanic-chip-template');
  const mechanicsHtml = game.mechanics.map(mech => {
    const clone = template.content.cloneNode(true);
    const chip = clone.querySelector('.tag-chip');
    chip.textContent = mech;
    return chip.outerHTML;
  }).join('');
  return createTagChipsContainer(mechanicsHtml);
}

function formatPlayerCount(players) {
  return players.map(([count, type]) => {

    let str = count;

    switch(type) {
      case 'b':
        str = `<strong>${count}★</strong>`;
        break;
      case 'rec':
        str = count;
        break;
      case 'sup':
        str = `<em>${count}~</em>`;
        break;
      case 'exp':
        str = `${count}⊕`
        break;
      case 'exp_s':
        str = `<em>${count}⊕~</em>`;
        break;
    }
    return str;
  }).join(', ');
}

function formatPlayerCountShort(players) {
  if (players.length === 0) return '';
  if (players.length === 1) return players[0][0];

  const minPlayers = Math.min(...players.map(p => parseInt(p[0])));
  const maxPlayers = Math.max(...players.map(p => parseInt(p[0])));

  return `${minPlayers}${minPlayers !== maxPlayers ? `-${maxPlayers}` : ''}`;
}

function getTeaserText(description, hasMore = false) {
  if (!description) return '';

  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return description;
  }

  let truncated = description.substring(0, MAX_DESCRIPTION_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 0) {
    truncated = truncated.substring(0, lastSpace);
  }
  truncated += '...';

  if (hasMore) {
    const template = document.getElementById('more-button-template');
    const clone = template.content.cloneNode(true);
    return truncated + ' ' + clone.querySelector('button').outerHTML;
  }

  return truncated;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderComplexityGauge(score) {
  if (isNaN(score)) return '';

  const template = document.getElementById('complexity-gauge-template');
  const clone = template.content.cloneNode(true);
  const svg = clone.querySelector('.complexity-gauge');
  const fgCircle = clone.querySelector('.gauge-fg');
  const text = clone.querySelector('.gauge-text');

  const circumference = 2 * Math.PI * GAUGE_RADIUS;
  const offset = circumference - (score / 5) * circumference;

  fgCircle.setAttribute('stroke-dasharray', circumference);
  fgCircle.setAttribute('stroke-dashoffset', offset);
  text.textContent = score.toFixed(1);

  return svg.outerHTML;
}

function getComplexityName(score) {
  if (isNaN(score) || score <= 0) return '';
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[0]) return CONFIG.COMPLEXITY_NAMES[0];
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[1]) return CONFIG.COMPLEXITY_NAMES[1];
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[2]) return CONFIG.COMPLEXITY_NAMES[2];
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[3]) return CONFIG.COMPLEXITY_NAMES[3];
  return CONFIG.COMPLEXITY_NAMES[4];
}

function renderRatingGauge(score) {
  if (isNaN(score) || score === 0) return '';

  const template = document.getElementById('rating-gauge-template');
  const clone = template.content.cloneNode(true);
  const svg = clone.querySelector('.rating-gauge');
  const fgCircle = clone.querySelector('.gauge-fg');
  const text = clone.querySelector('.gauge-text');

  const circumference = 2 * Math.PI * GAUGE_RADIUS;
  const offset = circumference - (score / 10) * circumference;

  fgCircle.setAttribute('stroke-dasharray', circumference);
  fgCircle.setAttribute('stroke-dashoffset', offset);
  text.textContent = score.toFixed(1);

  return svg.outerHTML;
}

function highlightText(text, query) {
  if (!query || query.length < 2) return text;

  const regex = new RegExp(`(${query})`, 'gi');
  return text.replace(regex, '<strong class="highlight">$1</strong>');
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;

  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
}

function getCurrentSearchQuery() {
  const searchInput = document.getElementById('search-input');
  return searchInput ? searchInput.value.toLowerCase().trim() : '';
}

function updateStats() {
  const statsContainer = document.getElementById('stats');
  const totalGames = filteredGames.length;
  const totalAllGames = allGames.length;

  let statsText = `${totalGames.toLocaleString()}`;
  if (totalGames !== totalAllGames) {
    statsText += ` of ${totalAllGames.toLocaleString()}`;
  }
  statsContainer.textContent = `${statsText} games`;
}

function createPaginationButton(page, text, isCurrent = false) {
  const template = document.getElementById('pagination-button-template');
  const clone = template.content.cloneNode(true);
  const button = clone.querySelector('.pagination-btn');

  button.textContent = text || page;
  button.onclick = () => goToPage(page);

  if (isCurrent) {
    button.className += ' current';
  }

  return button;
}

function createPaginationEllipsis() {
  const template = document.getElementById('pagination-ellipsis-template');
  const clone = template.content.cloneNode(true);
  return clone.querySelector('span');
}

function updatePagination() {
  const container = document.getElementById('pagination');
  const totalPages = Math.ceil(filteredGames.length / GAMES_PER_PAGE);

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const template = document.getElementById('pagination-template');
  const clone = template.content.cloneNode(true);
  const paginationDiv = clone.querySelector('.pagination');

  // Clear existing content
  paginationDiv.innerHTML = '';

  if (currentPage > 1) {
    paginationDiv.appendChild(createPaginationButton(currentPage - 1, '‹ Previous'));
  }

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1) {
    paginationDiv.appendChild(createPaginationButton(1));
    if (startPage > 2) paginationDiv.appendChild(createPaginationEllipsis());
  }

  for (let i = startPage; i <= endPage; i++) {
    const isCurrentPage = i === currentPage;
    paginationDiv.appendChild(createPaginationButton(i, i, isCurrentPage));
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) paginationDiv.appendChild(createPaginationEllipsis());
    paginationDiv.appendChild(createPaginationButton(totalPages));
  }

  if (currentPage < totalPages) {
    paginationDiv.appendChild(createPaginationButton(currentPage + 1, 'Next ›'));
  }

  container.innerHTML = '';
  container.appendChild(clone);
}

function goToPage(page) {
  currentPage = page;
  const state = getFiltersFromUI();
  updateURLWithFilters(state);
  updateResults();
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function getTextColorForBg(rgbColor) {
  const [r, g, b] = rgbColor.split(',').map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

function positionPopupInViewport(popup, trigger, clickEvent = null) {
  const triggerRect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 8;

  popup.style.height = '';
  popup.style.overflowY = '';
  const popupRect = popup.getBoundingClientRect();

  let desiredAbsoluteLeft = triggerRect.left + (triggerRect.width - popupRect.width) / 2;
  let desiredAbsoluteTop = triggerRect.top + (triggerRect.height - popupRect.height) / 2;

  let currentAbsoluteLeft = desiredAbsoluteLeft;
  let currentAbsoluteTop = desiredAbsoluteTop;

  if (currentAbsoluteLeft < margin) {
    currentAbsoluteLeft = margin;
  } else if (currentAbsoluteLeft + popupRect.width > viewportWidth - margin) {
    currentAbsoluteLeft = viewportWidth - margin - popupRect.width;
    if (currentAbsoluteLeft < margin) {
      currentAbsoluteLeft = margin;
    }
  }

  if (currentAbsoluteTop < margin) {
    currentAbsoluteTop = margin;
  } else if (currentAbsoluteTop + popupRect.height > viewportHeight - margin) {
    currentAbsoluteTop = viewportHeight - margin - popupRect.height;
    if (currentAbsoluteTop < margin) {
      currentAbsoluteTop = margin;
    }
  }

  const availableViewportHeight = viewportHeight - 2 * margin;
  if (popupRect.height > availableViewportHeight) {
    popup.style.height = availableViewportHeight + 'px';
    popup.style.overflowY = 'auto';
    currentAbsoluteTop = margin;
  }

  const finalLeftStyle = currentAbsoluteLeft - triggerRect.left;
  const finalTopStyle = currentAbsoluteTop - triggerRect.top;

  popup.style.left = finalLeftStyle + 'px';
  popup.style.top = finalTopStyle + 'px';
}

function on_render() {
  const gameCards = document.querySelectorAll(".game-card");
  gameCards.forEach(function (card) {
    const color = card.getAttribute("data-color") || "255,255,255";
    const textColor = getTextColorForBg(color);

    const gameDetails = card.querySelector(".game-details");
    if (gameDetails) {
      gameDetails.style.backgroundColor = '#FFFFFF';

      const cardHeader = card.querySelector(".card-header");
      if (cardHeader) {
        cardHeader.style.backgroundColor = `rgb(${color})`;
        cardHeader.style.color = textColor;
      }

      const statsBar = card.querySelector(".stats-bar");
      if (statsBar) {
        statsBar.style.backgroundColor = `rgba(${color}, 0.1)`;

        const gaugeFg = statsBar.querySelector(".gauge-fg");
        if (gaugeFg) {
          gaugeFg.style.stroke = `rgb(${color})`;
        }
      }

      const bottomInfo = card.querySelector(".bottom-info");
      if (bottomInfo) {
        const ratingGaugeFg = bottomInfo.querySelector(".rating-gauge .gauge-fg");
        if (ratingGaugeFg) {
          ratingGaugeFg.style.stroke = `rgb(${color})`;
        }
      }

      const gameDetailsIcons = gameDetails.querySelectorAll(".icon-themed");
      gameDetailsIcons.forEach(function (icon) {
        icon.style.color = `rgb(${color})`;
      });
    }
  });

  setupGameDetails();
}

function setupGameDetails() {
  const summaries = document.querySelectorAll("summary");
  summaries.forEach(function (elem) {
    function conditionalClose(event) {
      closeAllDetails();
      if (!elem.parentElement.hasAttribute("open")) {
        const gameDetails = elem.parentElement.querySelector(".game-details");
        if (gameDetails) {
          gameDetails.focus();
          requestAnimationFrame(() => {
            positionPopupInViewport(gameDetails, elem, event);
          });
        }
      }
    }
    elem.addEventListener("click", conditionalClose);
  });

  const gameDetails = document.querySelectorAll(".game-details");
  gameDetails.forEach(function (elem) {
    let closeButton = elem.querySelector('.close-button');

    function closeDetails(event) {
      elem.parentElement.removeAttribute("open");
      event.stopPropagation();
    }

    if (closeButton) {
      closeButton.addEventListener("click", closeDetails);
      closeButton.addEventListener("keypress", closeDetails);
    }

    elem.addEventListener("click", function (event) {
      event.stopPropagation();
    });
  });

}

function closeAllDetails() {
  const openDetails = document.querySelectorAll("details[open]");
  openDetails.forEach(function (elem) {
    elem.removeAttribute("open");
  });
}

function closeAll(event) {
  closeAllDetails();
}

document.addEventListener("click", closeAll);

function init(settings) {
  console.log('Initializing mybgg SQLite app...');
  initializeDatabase(settings);
}

loadINI('./config.ini', function (settings) {
  console.log('Settings loaded:', settings);
  init(settings);
});

function resetSlider(sliderId) {
  const sliderDropdown = document.getElementById(sliderId);
  if (!sliderDropdown) {
      console.error('Slider not found!');
      return;
  }

  // Retrieve the initial min and max values from data attributes
  const min = parseInt(sliderDropdown.getAttribute('data-min'), 10);
  const max = parseInt(sliderDropdown.getAttribute('data-max'), 10);

  const minHandle = sliderDropdown.querySelector('.slider-min');
  const maxHandle = sliderDropdown.querySelector('.slider-max');
  const minLabel = sliderDropdown.querySelector('.slider-min-label');
  const maxLabel = sliderDropdown.querySelector('.slider-max-label');

  minHandle.style.left = '0%';
  maxHandle.style.left = '100%';

  minLabel.style.left = '0%';
  maxLabel.style.left = '100%';

  minLabel.textContent = min;
  maxLabel.textContent = max;

  onFilterChange();
}
