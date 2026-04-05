// ===============================================================
// UTILITY FUNCTIONS
// ===============================================================

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];  

const pad = (num) => num.toString().padStart(2, '0');

function fmtElapsed(ms) {
  const s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

function fmtNiceTime(time) {
  const useUTC = !document.getElementById('time-format').checked;
  d = new Date(time);
  if (useUTC) {
    s = d.getUTCDate() + " " + months[d.getUTCMonth()] + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " UTC";
  } else {
    s = d.getDate() + " " + months[d.getMonth()] + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  return s;
}

function fmtDuration(ms) {
  const s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  result = "";
  if (d > 0) result += d + "d";
  if (h > 0) result += h + "h";
  if (m > 0) result += m + "m";
  result += ss + "s";
  return result;
}

function interpPosVelAtTime(data, time)  {
  const N = data.t.length;
  const t0 = data.t[0].getTime();
  const tf = data.t[N-1].getTime();
  if (time < t0 || time > tf) return null;
  const f = (time - t0)/(tf - t0);
  const idx = f * (N - 1);
  const lo = Math.floor(idx), hi = Math.min(lo + 1, N - 1);
  const t = idx - lo;
  return {
    x: data.x[lo] + (data.x[hi]-data.x[lo])*t,
    y: data.y[lo] + (data.y[hi]-data.y[lo])*t,
    z: data.z[lo] + (data.z[hi]-data.z[lo])*t,
    vx: data.vx[lo] + (data.vx[hi]-data.vx[lo])*t,
    vy: data.vy[lo] + (data.vy[hi]-data.vy[lo])*t,
    vz: data.vz[lo] + (data.vz[hi]-data.vz[lo])*t
  };
}

// ===============================================================

async function init() {

  const fig = document.getElementById('plot');

  // ===============================================================
  // CONFIGURATION
  // ===============================================================

  // Load Spacecraft and Moon trajectory data in multiple frames
  // format: { time: ISO string, x, y, z in meters, vx, vy, vz in m/s}
  // const dataS = await loadTrajectoryCSV('Artemis2_geocentric.csv');
  // const dataM = await loadTrajectoryCSV('Moon_geocentric.csv');
  all_dataS = [
    await loadTrajectoryCSV('data/Artemis2_geocentric.csv'),
    await loadTrajectoryCSV('data/Artemis2_orbit_plane.csv'),
    await loadTrajectoryCSV('data/Artemis2_corotating_mean.csv'),
    await loadTrajectoryCSV('data/Artemis2_corotating_inst.csv'),
    // await loadTrajectoryCSV('Artemis2_corotating_fixed.csv'),
  ]
  all_dataM = [
    await loadTrajectoryCSV('data/Moon_geocentric.csv'),
    await loadTrajectoryCSV('data/Moon_orbit_plane.csv'),
    await loadTrajectoryCSV('data/Moon_corotating_mean.csv'),
    await loadTrajectoryCSV('data/Moon_corotating_inst.csv'),
    // await loadTrajectoryCSV('Moon_corotating_fixed.csv'),
  ]

  // Load and parse events from JSON file
  const _response = await fetch('events.json');
  const events_json = await _response.json();
  const milestones = Object.fromEntries(
    Object.entries(events_json.milestones).map(([name, isostr]) => {
      date = new Date(isostr);
      return [name, {"time": date.getTime(), "Date": date, "isostr": isostr}];
    })
  );
  _events = events_json.events.map(ev => {
    date = new Date(ev.isostr);
    return {"time": date.getTime(), "Date": date, "isostr": ev.isostr, "name": ev.name}
  })
  const events = _events.sort((a, b) => a.time - b.time);

  // Animation FPS
  const FPS = 10;

  // ===============================================================
  // Parse stuff -- distances in km, speeds in km/s
  // ===============================================================

  var dataS = all_dataS[1];
  var dataM = all_dataM[1];

  const times = dataS.t;
  const N = times.length;

  const tLaunch = milestones["LAUNCH"].time;
  // const tLaunch = milestones['LAUNCH'].getTime();
  // const tTLI =  milestones['TLI'].getTime();
  // const tSOIEntry =  milestones['MOON_SOI_ENTRY'].getTime();
  // const tSOIExit =  milestones['MOON_SOI_EXIT'].getTime();
  // const tSplashdown =  milestones['SPLASHDOWN'].getTime();
  // const tEntry =  milestones['ENTRY_INT'].getTime();
  const tEnd = milestones['MISSION_END'].time;
  const tDataStart = times[0].getTime();
  const tDataEnd = times[N-1].getTime();

  // Constants, in km
  const EARTH_R = 6371;
  const MOON_R = 1737;
  const MOON_SOI_R = 64300;

  const frameInterval = 1000 / FPS;
  var lastFrame = 0;
  var layout;

  // ===============================================================
  // Build Plotly scene
  // ===============================================================

  function genSphereSurface(cx, cy, cz, r, steps) {
    const x = [], y = [], z = [];
    for (let i = 0; i <= steps; i++) {
      const row_x = [], row_y = [], row_z = [];
      const theta = (i / steps) * Math.PI;
      for (let j = 0; j <= steps; j++) {
        const phi = (j / steps) * 2 * Math.PI;
        row_x.push(cx + r * Math.sin(theta) * Math.cos(phi));
        row_y.push(cy + r * Math.sin(theta) * Math.sin(phi));
        row_z.push(cz + r * Math.cos(theta));
      }
      x.push(row_x); y.push(row_y); z.push(row_z);
    }
    return { x, y, z };
  }

  function offsetSphere(sph, xoff, yoff, zoff) {
    return {
      x: sph.x.map(row => row.map(v => v + xoff)),
      y: sph.y.map(row => row.map(v => v + yoff)),
      z: sph.z.map(row => row.map(v => v + zoff)),
    };
  }

  // Create mesh spheres for the Earth and Moon
  var es = genSphereSurface(0, 0, 0, EARTH_R, 32);
  var ms0 = genSphereSurface(0, 0, 0, MOON_R, 16);
  var mSOI = genSphereSurface(0, 0, 0, MOON_SOI_R, 32)

  function createPlot() {

  // Earth
  const EarthSphere = {
    type: 'surface', ...es,
    colorscale: [[0, '#1a6fa8'], [1, '#1a6fa8']],
    showscale: false, opacity: 1.0,
    hoverinfo: 'skip', showlegend: false, name: 'Earth',
    contours: { x: { highlight: false }, y: { highlight: false }, z: { highlight: false } }
  };

  // Moon
  const MoonSphere = {
    ...ms0,
    type: 'surface',
    colorscale: [[0, '#9ca3af'], [1, '#9ca3af']],
    showscale: false, opacity: 1.0,
    hoverinfo: 'skip', showlegend: false, name: 'Moon',
    contours: { x: { highlight: false }, y: { highlight: false }, z: { highlight: false } }
  };

  // Moon orbit
  const MoonOrbit = {
    type: 'scatter3d', mode: 'lines',
    x: dataM.x, y: dataM.y, z: dataM.z,
    line: { color: 'gray', width: 1 },
    name: 'Moon\'s orbit',
    showlegend: false,
    hoverinfo: 'skip'
  };

  // Moon's SOI
  const MoonSOISphere = {
    ...mSOI,
    type: 'surface',
    colorscale: [[0, '#555'], [1, '#555']],
    showscale: false, opacity: 0.1,
    hoverinfo: 'skip', showlegend: false, name: "Moon's SOI",
    contours: { x: { highlight: false }, y: { highlight: false }, z: { highlight: false } }
  };

  // Full trajectory
  const fullTrail = {
    type: 'scatter3d', mode: 'lines',
    x: dataS.x, y: dataS.y, z: dataS.z,
    line: { color: 'white', width: 1.5 },
    name: 'Trajectory, planned',
    hoverinfo: 'skip'
  };

  // Past trajectory
  const pastTrail = {
    type: 'scatter3d', mode: 'lines',
    x: [dataS.x[0]], y: [dataS.y[0]], z: [dataS.z[0]],
    line: { color: 'lime', width: 3 },
    name: 'Trajectory, elapsed',
    hoverinfo: 'skip'
  };

  // Spacecraft marker
  const scMarker = {
    type: 'scatter3d',
    mode: 'markers',
    x: [dataS.x[0]], y: [dataS.y[0]], z: [dataS.z[0]],
    marker: {
      size: 5,
      color: 'lime',
      symbol: 'diamond',
      // line: { color: 'white', width: 1 }
    },
    name: 'Orion Spacecraft',
    hoverinfo: 'name',
    hoverlabel: {
      namelength: -1,
      bgcolor: 'black',
      font: {
        color: 'white'
      }
    },
    // hovertemplate: 'X: %{x:.0f} km<br>Y: %{y:.0f} km<br>Z: %{z:.0f} km<extra>Spacecraft</extra>'
  };

  // Earth & Moon labels as scatter3d text
  const EarthLabel = {
    type: 'scatter3d', mode: 'text',
    x: [0], y: [0], z: [EARTH_R * 1.35],
    text: 'Earth',
    textfont: { color: '#7dd3fc', size: 12 },
    hoverinfo: 'skip', showlegend: false, name: ''
  };
  const MoonLabel = {
    type: 'scatter3d', mode: 'text',
    x: [0], y: [0], z: [MOON_R * 1.5],
    text: 'Moon',
    textfont: { color: '#d1d5db', size: 12 },
    hoverinfo: 'skip', showlegend: false, name: ''
  };

  // Mission events markers
  evxs = []; evys = []; evzs = []; evtexts = []; evdates = [];
  events.forEach(ev => {
    const evTime = new Date(ev.time).getTime();
    posvel = interpPosVelAtTime(dataS, evTime);
    if (posvel === null) return;
    evxs.push(posvel.x);
    evys.push(posvel.y);
    evzs.push(posvel.z);
    evtexts.push(ev.name);
    evdates.push([fmtNiceTime(evTime)]);
  });
  const eventsTrace = {
    type: 'scatter3d',
    mode: 'markers',
    x: evxs, y: evys, z: evzs,
    text: evtexts,
    customdata: evdates,
    marker: {
      size: 2,
      color: '#00e5ff',
    },
    showlegend: false,
    hoverlabel: {
      namelength: -1,
      bgcolor: '#002730',
      font: {
        color: 'white'
      }
    },
    hovertemplate: '%{text}<br>%{customdata[0]}<extra></extra>'
  };

  var axisStyle = {
    visible: true,
    showgrid: true,
    gridcolor: 'rgba(0.2,0.2,0.2)',
    gridwidth: 1,
    zeroline: false,
    showline: false,
    showspikes: false,
    tickfont: { color: 'rgba(0.4,0.4,0.4)', size: 12, family: 'Share Tech Mono' },
    title: { font: { color: 'rgba(0.4,0.4,0.4)', size: 14, family: 'Share Tech Mono' } }
  };

  // Make axes aspect ratio square
  // const allCoords = [...dataS.x, ...dataS.y, ...dataS.z];
  //const allCooMoonOrbitrds = [...dataS.x, ...dataS.y, ...dataS.z ALSO ADD MOON coords];
  // const maxExtent = Math.max(...allCoords.map(Math.abs));
  // Manual extent
  maxExtent = 470e3;
  var axisRange = [-maxExtent, maxExtent];

  // Global layout
  layout = {
    uirevision: 'same-on-every-call',
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor:  'rgba(0,0,0,0)',
    margin: { l: 0, r: 0, t: 0, b: 0 },
    scene: {
      // dragmode: "turntable",
      // uirevision: 'true',
      bgcolor: '#000',
      xaxis: { ...axisStyle, title: { text: 'X (km)', ...axisStyle.title }, range: axisRange, visible: false },
      yaxis: { ...axisStyle, title: { text: 'Y (km)', ...axisStyle.title }, range: axisRange, visible: false },
      zaxis: { ...axisStyle, title: { text: 'Z (km)', ...axisStyle.title }, range: axisRange, visible: false },
      aspectmode: 'cube',
      camera: {
        eye: {x: -0.077, y: -0.23, z: 0.5},
        up: {x: 1, y: -0.35, z: 0},
        center: {x: -0.077, y: -0.23, z: 0}
      },
    },
    legend: {
      font: { color: 'rgba(200,230,234,0.5)', size: 14, family: 'Share Tech Mono' },
      bgcolor: 'rgba(0,0,0,0)',
      x: 0.01, y: 0.99
    }
  };

  traces = [
    EarthSphere,
    MoonSphere,
    fullTrail,
    pastTrail,
    scMarker,
    EarthLabel,
    MoonLabel,
    MoonOrbit,
    MoonSOISphere,
    eventsTrace
  ];

  Plotly.newPlot('plot',
    traces,
    layout,
    { responsive: true, displayModeBar: true }
  );

  }

  createPlot();

  // ===============================================================
  // Events list
  // ===============================================================

  const eventsList = document.getElementById('events-list');

  function renderNextEvent(time) {

    const pin = document.getElementById('next-event-pin');
    const nextIdx = events.findIndex(ev => (new Date(ev.time).getTime() - time) > 0);
    if (nextIdx === -1) {
      pin.innerHTML = `<div class="event-name" style="color:var(--text-dim);font-size:16px">Mission complete</div>`;
      return;
    }
    const next = events[nextIdx];
    const evTime = new Date(next.time).getTime();
    const timeToEv = evTime - time;    
    pin.innerHTML = `
      <div class="event-item next" style="border-bottom:none;margin:0;padding:0">
        <div class="event-dot"></div>
        <div class="event-body">
          <div class="event-name">${next.name}</div>
          <div class="event-time">
            <span>T-${fmtDuration(timeToEv)}</span>
            <span>${fmtNiceTime(evTime)}</span>
          </div>          
        </div>
      </div>`;
  }

  function renderEvents(time) {
    
    eventsList.innerHTML = '';

    // Next Event
    const nextIdx = events.findIndex(ev => (new Date(ev.time).getTime() - time) > 0);

    events.forEach((ev, i) => {
      const evTime = new Date(ev.time).getTime();
      const timeToEv = evTime - time;
      const isNext   = i === nextIdx;
      const isActive = Math.abs(timeToEv) < 10*60*1000;
      const isPast   = timeToEv < 0 && !isActive;

      const item = document.createElement('div');
      item.className = 'event-item' + (isPast ? ' past' : '') + (isActive ? ' active' : '');

      if (isPast) {
        remainStr = "T+" + fmtDuration(timeToEv);
        timeStr = fmtNiceTime(evTime)
      } else {
        remainStr = "T-" + fmtDuration(timeToEv);
        timeStr = fmtNiceTime(evTime)
      } 

      item.innerHTML = `
        <div class="event-dot"></div>
        <div class="event-body">
          <div class="event-name" title="${ev.name}">${ev.name}</div>
          <div class="event-time">
            <span>${remainStr}</span>
            <span>${timeStr}</span>
          </div>
        </div>`;
      eventsList.appendChild(item);
    });

    // Scroll to active event
    const activeEl = eventsList.querySelector('.event-item.active, .event-item.next');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

  }

  // ===============================================================
  // Animation and time controls
  // ===============================================================

  const scrubber  = document.getElementById('scrubber');
  // const timeLabel = document.getElementById('speed-label');
  const btnPlay   = document.getElementById('btn-play');
  const btnRt     = document.getElementById('btn-rt');
  const speedSel  = document.getElementById('speed-select');
  const frameSel  = document.getElementById('frame-select');
  const cdDisplay = document.getElementById('countdown-display');
  const clockDsp  = document.getElementById('clock-display');
  const notesDiv  = document.getElementById('notes-div');

  let curTime = Date.now();
  let playing = false;
  let rafId = null;

  function updateMain(time) {

    // Mission Elapsed Time; can be negative
    MET = time - tLaunch;

    // Moon position, label and SOI
    posvelM = interpPosVelAtTime(dataM, time);
    if (posvelM) {
      _ms = offsetSphere(ms0, posvelM.x, posvelM.y, posvelM.z);
      _mSOI = offsetSphere(mSOI, posvelM.x, posvelM.y, posvelM.z);
      // Mesh sphere
      // fig.data[1] = {
      //   ...fig.data[1],
      //   x: ms.x, y: ms.y, z: ms.z,
      //   visible: true
      // }
      // Moon
      fig.data[1].x = _ms.x.map(row => [...row]);
      fig.data[1].y = _ms.y.map(row => [...row]);
      fig.data[1].z = _ms.z.map(row => [...row]);
      // SOI
      fig.data[8].x = _mSOI.x.map(row => [...row]);
      fig.data[8].y = _mSOI.y.map(row => [...row]);
      fig.data[8].z = _mSOI.z.map(row => [...row]);
      // Label
      fig.data[6].x = [posvelM.x];
      fig.data[6].y = [posvelM.y];
      fig.data[6].z = [posvelM.z+MOON_R*1.5];
    }

    if (MET < 0) {

      cdDisplay.textContent = 'T-' + fmtElapsed(MET);
      cdDisplay.className = 'prev';

      // Hide spacecraft and elapsed trajectory    
      fig.data[3].visible = false;
      fig.data[4].visible = false;
      document.getElementById('telem-alt').textContent = '—';
      document.getElementById('telem-moon').textContent = '—';
      document.getElementById('telem-speed').textContent = '—';

    } else {

      cdDisplay.textContent = 'T+' + fmtElapsed(MET);
      cdDisplay.className = 'past';

      // Only display telemetry and position if past data start
      if (time >= tDataStart && time <= tDataEnd) {

        let f = (time - tDataStart) / (tDataEnd - tDataStart);

        const cutIdx = Math.round(f * (N - 1));
        const posvel = interpPosVelAtTime(dataS, time);

        // Update spacecraft "elapsed" trajectory
        // fig.data[3] = {
        //   ...fig.data[3],
        //   x: dataS.x.slice(0, cutIdx + 1),
        //   y: dataS.y.slice(0, cutIdx + 1),
        //   z: dataS.z.slice(0, cutIdx + 1),
        //   visible: true,
        // }
        fig.data[3].x = dataS.x.slice(0, cutIdx + 1);
        fig.data[3].y = dataS.y.slice(0, cutIdx + 1);
        fig.data[3].z = dataS.z.slice(0, cutIdx + 1);
        fig.data[3].visible = true;        
        
        // Update spacecraft position
        // fig.data[4] = {
        //   ...fig.data[4],
        //   x: [posvel.x],
        //   y: [posvel.y],
        //   z: [posvel.z],
        //   visible: true,
        // }
        // Spacecraft marker
        fig.data[4].x = [posvel.x];
        fig.data[4].y = [posvel.y];
        fig.data[4].z = [posvel.z];
        fig.data[4].visible = true;        

        // Sidebar telemetry
        const alt = Math.sqrt(posvel.x**2 + posvel.y**2 + posvel.z**2) - EARTH_R;
        const speed = Math.sqrt(posvel.vx**2 + posvel.vy**2 + posvel.vz**2);
        const dMoon = Math.sqrt((posvel.x-posvelM.x)**2 + (posvel.y-posvelM.y)**2 + (posvel.z-posvelM.z)**2);
        // const dMoon = 0;

        document.getElementById('telem-alt').textContent  = alt > 0 ? alt.toLocaleString('en',{maximumFractionDigits:0}) + ' km' : '—';
        document.getElementById('telem-moon').textContent = dMoon.toLocaleString('en',{maximumFractionDigits:0}) + ' km';
        document.getElementById('telem-speed').textContent  = speed.toFixed(2) + ' km/s';

      } else {

        // Hide plotly spacecraft position
        fig.data[3].visible = false;
        fig.data[4].visible = false;
        document.getElementById('telem-alt').textContent = '—';
        document.getElementById('telem-moon').textContent = '—';
        document.getElementById('telem-speed').textContent = '—';

      }

    }

    // Mission Phase
    const phase = time < tLaunch ? 'Pre-launch'
      : time < milestones["TLI"].time ? 'Earh orbit'
      : time < milestones["MOON_SOI_ENTRY"].time ? 'Trans-lunar coast'
      : time < milestones["MOON_SOI_EXIT"].time ? 'Lunar space'
      : time < milestones["ENTRY_INT"].time ? 'Earth return coast'
      : time < milestones["MISSION_END"].time ? 'Entry & landing'
      : 'Mission ended';
    document.getElementById('telem-phase').textContent = phase;

    // Mission clock
    const src = playing ? 'PLAYBACK' : 'TIME';
    const dt = new Date(time);
    if (!document.getElementById('time-format').checked) {;
      displayTime = dt.toISOString().replace('T',' ').slice(0,19) + ' UTC';
    } else {
      displayTime = dt.getFullYear() + "-" + pad(dt.getMonth()+1) + "-" + pad(dt.getDate()) + " " + pad(dt.getHours()) + ":" + pad(dt.getMinutes()) + ":" + pad(dt.getSeconds());
    }
    clockDsp.textContent = displayTime;

    // Update scrubber
    f = (time - tLaunch)/(tEnd - tLaunch);
    scrubber.value = Math.round(f * 10000);
    // timeLabel.textContent = fmtNiceTime(time);
    
    // Update events
    renderNextEvent(time);
    renderEvents(time);

    // Batch apply all Plotly updates
    const liveCamera = getLiveCamera();
    if (liveCamera && !isDragging) layout.scene.camera = liveCamera;
    if (!isDragging) Plotly.react('plot', fig.data, layout);

  }

  // Playback loop
  function rafLoop() {
    let now = Date.now();
    let elapsed = now - lastFrame;
    if (elapsed > frameInterval) {
      const animSpeed = parseFloat(speedSel.value);
      curTime += animSpeed * elapsed;
      updateMain(curTime);
      lastFrame = now;
    }
    if (playing) rafId = requestAnimationFrame(rafLoop);
  }

  function startPlay() {
    playing = true;
    lastFrame = Date.now();
    btnPlay.textContent = '⏸ PAUSE';
    btnPlay.classList.add('active');
    rafId = requestAnimationFrame(rafLoop);
  }

  function stopPlay() {
    playing = false;
    btnPlay.textContent = '▶ PLAY';
    btnPlay.classList.remove('active');
    if (rafId) cancelAnimationFrame(rafId);
  }

  function jumpToNow() {
    curTime = Date.now();
    updateMain(curTime);
    startPlay();    
  }

  function updateFromScrubber() {
    stopPlay();
    let offset = scrubber.value / 10000;
    curTime  = tLaunch + offset * (tEnd - tLaunch);
    updateMain(curTime);
  }

  function setCoordFrame(idx) {
    dataS = all_dataS[idx];
    dataM = all_dataM[idx];
    createPlot();
    updateMain(curTime);
  }

  // Frame control listeners
  frameSel.addEventListener('change', (event) => {
    value = event.target.value;
    console.log('Selected frame:', value);
    setCoordFrame(parseInt(value));
  });

  // Time controls listeners
  btnPlay.addEventListener('click', () => { playing ? stopPlay() : startPlay(); });
  btnRt.addEventListener('click', jumpToNow);
  scrubber.addEventListener('input', updateFromScrubber);

  // View dragging workaround 
  let isDragging = false;
  const canvas = document.querySelector('#plot canvas');
  canvas.addEventListener('mousedown', () => isDragging = true);
  window.addEventListener('mouseup', () => isDragging = false);

  notesDiv.innerHTML = `Data from ${events_json.source} (${events_json.rev_date}) • By meithan cc-by-sa`;

  function getLiveCamera() {
    try {
      const glCam = fig._fullLayout.scene._scene.glplot.camera;
      const cam = {
        eye:    { x: glCam.eye[0],    y: glCam.eye[1],    z: glCam.eye[2]    },
        center: { x: glCam.center[0], y: glCam.center[1], z: glCam.center[2] },
        up:     { x: glCam.up[0],     y: glCam.up[1],     z: glCam.up[2]     }
      };
      // console.log('isDragging:', isDragging, 'eye:', JSON.stringify(cam.eye));
      return cam;
    } catch(e) {
      console.log('getLiveCamera failed:', e);
      return null;
    }
  }

  // On load, set time to current time and play
  updateMain(Date.now());
  startPlay();

  // ================================================================
  // Load and parse trajectory data in CSV with the following fields:
  // yyy-mm-ddThh:mm:ssZ,x,y,z,vx,v,yz
  // Positions in km, speeds in km/s
  // ================================================================
  async function loadTrajectoryCSV(url) {
    const resp = await fetch(url);
    const text = await resp.text();
    // const lines = text.trim().split('\n').slice(1); // skip header
    const lines = text.trim().split('\n');
    t = []; x = []; y = []; z = []; vx = []; vy = []; vz = [];
    lines.forEach(line => {
      const [_t, _x, _y, _z, _vx, _vy, _vz] = line.split(',');
      t.push(new Date(_t));
      x.push(parseFloat(_x));
      y.push(parseFloat(_y));
      z.push(parseFloat(_z));
      vx.push(parseFloat(_vx));
      vy.push(parseFloat(_vy));
      vz.push(parseFloat(_vz));
    });
    return {t, x, y, z, vx, vy, vz}
  }

}

init();