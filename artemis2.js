// ===============================================================
// MAIN CONFIGURATION AND GLOBALS
// ===============================================================

// Constants, in km
const EARTH_R = 6371;
const MOON_R = 1737;
const MOON_SOI_R = 66000;

const data_files = {
  "FRAME_ECI": ['data/Artemis2_geocentric.csv', 'data/Moon_geocentric.csv'],
  "FRAME_MOON_PLANE": ['data/Artemis2_orbit_plane.csv', 'data/Moon_orbit_plane.csv'],
  "FRAME_COROT_MEAN": ['data/Artemis2_corotating_mean.csv', 'data/Moon_corotating_mean.csv'],
  "FRAME_COROT_INST": ['data/Artemis2_corotating_inst.csv', 'data/Moon_corotating_inst.csv'],
  "FRAME_FLYBY": ['data/Artemis2_flyby.csv', null]
}

// Animation
const FPS = 10;
const frameInterval = 1000 / FPS;
var lastFrame = 0;
var playing = false;
var live = false;
var rafId;
var isDragging;

// Reference frame
// const defaultFrame = "FRAME_ECI";
const defaultFrame = "FRAME_MOON_PLANE";
// const defaultFrame = "FRAME_FLYBY";
var refFrame;

// Plotly
var fig, layout, canvas;

// Trajectory data
var all_dataS = {}, all_dataM = {};
var dataS, dataM;

// Other globals
var events, milestones, times, N, tLaunch, tEnd, tDataStart, tDataEnd, curTime, MET;

// UI DOM elements
var eventsList, scrubber, btnPlay, btnLive, speedSel, frameSel, cdDisplay, clockDsp, notesDiv

// ===============================================================
// UTILITY FUNCTIONS
// ===============================================================

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];  

const pad = (num) => num.toString().padStart(2, '0');

// Format Mission Elapsed Time
function fmtElapsed(ms) {
  const s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

// Format a Datetime object nicely
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

// Format a time duration, in milliseconds
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

// Interpolate position and velocit at given time
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

// ================================================================
// DATA LOADING
// ================================================================

// Wrapper to load both data files
async function loadData(refFrame) {
  [fnameS, fnameM] = data_files[refFrame];
  all_dataS[refFrame] = await loadTrajectoryCSV(fnameS);
  console.log("Loaded", fnameS);
  if (refFrame != "FRAME_FLYBY") {
    all_dataM[refFrame] = await loadTrajectoryCSV(fnameM);
    console.log("Loaded", fnameM);
  }
}

// Load and parse trajectory data in CSV with the following fields:
// yyy-mm-ddThh:mm:ssZ,x,y,z,vx,v,yz
// Positions in km, speeds in km/s
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

// ===============================================================
// PLOTLY.JS PLOTTING
// ===============================================================

// Generate a mesh sphere given center, radius and steps
function genSphereSurface(cx, cy, cz, r, steps) {
  const x = [], y = [], z = [];
  for (let i = 0; i <= steps; i++) {
    const row_x = [], row_y = [], row_z = [];
    const theta = (i / steps) * Math.PI;
    for (let j = 0; j <= steps; j++) {
      const phi = (j / steps) * 2 * Math.PI;
      row_z.push(cx + r * Math.sin(theta) * Math.cos(phi));
      row_y.push(cy + r * Math.sin(theta) * Math.sin(phi));
      row_x.push(cz + r * Math.cos(theta));
    }
    x.push(row_x); y.push(row_y); z.push(row_z);
  }
  return { x, y, z };
}

// Offsets the center of a sphere
function offsetSphere(sph, xoff, yoff, zoff) {
  return {
    x: sph.x.map(row => row.map(v => v + xoff)),
    y: sph.y.map(row => row.map(v => v + yoff)),
    z: sph.z.map(row => row.map(v => v + zoff)),
  };
}

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

// Main function to create the plot
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
    ...mSOI0,
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
      dragmode: "orbit",
      // uirevision: 'true',
      bgcolor: '#000',
      xaxis: { ...axisStyle, title: { text: 'X (km)', ...axisStyle.title }, range: axisRange, visible: false },
      yaxis: { ...axisStyle, title: { text: 'Y (km)', ...axisStyle.title }, range: axisRange, visible: false },
      zaxis: { ...axisStyle, title: { text: 'Z (km)', ...axisStyle.title }, range: axisRange, visible: false },
      aspectmode: 'cube',
      // camera: {
      //   eye: {x: -0.077, y: -0.23, z: 0.5},
      //   up: {x: 1, y: -0.35, z: 0},
      //   center: {x: -0.077, y: -0.23, z: 0}
      // },
      // camera: {
      //   eye: {x: 0, y: 0, z: 0.25},
      //   up: {x: 0, y: 0, z: 1},
      //   center: {x: 0, y: 0, z: 0}
      // },
    },
    legend: {
      font: { color: 'rgba(200,230,234,0.5)', size: 14, family: 'Share Tech Mono' },
      bgcolor: 'rgba(0,0,0,0)',
      x: 0.01, y: 0.99
    }
  };

  to_show = [
    [EarthSphere, "Earth"],
    [MoonSphere, "Moon"],
    [fullTrail, "fullTrail"],
    [pastTrail, "pastTrail"],
    [scMarker, "craft"],
    [EarthLabel, "EarthLabel"],
    [MoonLabel, "MoonLabel"],
    [MoonOrbit, "MoonOrbit"],
    [MoonSOISphere, "MoonSOI"],
    [eventsTrace, "events"]
  ];

  traces = [];
  traceIdx = {};
  for (var i = 0; i < to_show.length; i++) {
    traces.push(to_show[i][0]);
    traceIdx[to_show[i][1]] = i;
  }

  Plotly.newPlot('plot',
    traces,
    layout,
    { responsive: true, displayModeBar: true }
  );

}

// ===============================================================
// EVENTS LIST
// ===============================================================

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
    const isActive = (timeToEv > 0) && (timeToEv < 10*60*1000);
    const isPast   = timeToEv < 0;

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
    activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

}

function scrollToNextEvent(time) {
  const nextIdx = events.findIndex(ev => (new Date(ev.time).getTime() - time) > 0);
  if (nextIdx < 0) return;
  const ev = events[nextIdx];
  const nextEvent = eventsList.querySelector(`[title=\"${ev.name}\"]`);
  nextEvent.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ===============================================================
// ANIMATION LOOP
// ===============================================================

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

// Main update function, to be called by the animation loop
function updateMain(time) {

  // Mission Elapsed Time; can be negative, stops increasing after mission end
  MET = Math.min(time, tEnd) - tLaunch;

  // Moon position, label and SOI
  var posvelM = interpPosVelAtTime(dataM, time);
  if (posvelM) {
    _ms = offsetSphere(ms0, posvelM.x, posvelM.y, posvelM.z);
    _mSOI = offsetSphere(mSOI0, posvelM.x, posvelM.y, posvelM.z);
    // Mesh sphere
    // fig.data[1] = {
    //   ...fig.data[1],
    //   x: ms.x, y: ms.y, z: ms.z,
    //   visible: true
    // }
    // Moon
    fig.data[traceIdx["Moon"]].x = _ms.x.map(row => [...row]);
    fig.data[traceIdx["Moon"]].y = _ms.y.map(row => [...row]);
    fig.data[traceIdx["Moon"]].z = _ms.z.map(row => [...row]);
    // SOI
    fig.data[traceIdx["MoonSOI"]].x = _mSOI.x.map(row => [...row]);
    fig.data[traceIdx["MoonSOI"]].y = _mSOI.y.map(row => [...row]);
    fig.data[traceIdx["MoonSOI"]].z = _mSOI.z.map(row => [...row]);
    // Label
    fig.data[traceIdx["MoonLabel"]].x = [posvelM.x];
    fig.data[traceIdx["MoonLabel"]].y = [posvelM.y];
    fig.data[traceIdx["MoonLabel"]].z = [posvelM.z+MOON_R*1.5];
  }

  if (refFrame == "FRAME_FLYBY") {
    fig.data[traceIdx["Earth"]].visible = false;
    fig.data[traceIdx["EarthLabel"]].visible = false;
  } else {
    fig.data[traceIdx["Earth"]].visible = true;
    fig.data[traceIdx["EarthLabel"]].visible = true;
  }

  if (MET < 0) {

    cdDisplay.textContent = 'T-' + fmtElapsed(MET);
    cdDisplay.className = 'prev';

    // Hide spacecraft and elapsed trajectory    
    fig.data[traceIdx["pastTrail"]].visible = false;
    fig.data[traceIdx["craft"]].visible = false;
    document.getElementById('telem-alt').textContent = '—';
    document.getElementById('telem-moon').textContent = '—';
    document.getElementById('telem-speed').textContent = '—';

  } else {

    cdDisplay.textContent = 'T+' + fmtElapsed(MET);
    cdDisplay.className = 'past';

    // Only display telemetry and position during mission
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
      fig.data[traceIdx["pastTrail"]].x = dataS.x.slice(0, cutIdx + 1);
      fig.data[traceIdx["pastTrail"]].y = dataS.y.slice(0, cutIdx + 1);
      fig.data[traceIdx["pastTrail"]].z = dataS.z.slice(0, cutIdx + 1);
      fig.data[traceIdx["pastTrail"]].visible = true;        
      
      // Update spacecraft position
      // fig.data[4] = {
      //   ...fig.data[4],
      //   x: [posvel.x],
      //   y: [posvel.y],
      //   z: [posvel.z],
      //   visible: true,
      // }
      // Spacecraft marker
      fig.data[traceIdx["craft"]].x = [posvel.x];
      fig.data[traceIdx["craft"]].y = [posvel.y];
      fig.data[traceIdx["craft"]].z = [posvel.z];
      fig.data[traceIdx["craft"]].visible = true;        

      // Sidebar telemetry
      const alt = Math.sqrt(posvel.x**2 + posvel.y**2 + posvel.z**2) - (refFrame == "FRAME_FLYBY" ? MOON_R : EARTH_R);
      const speed = Math.sqrt(posvel.vx**2 + posvel.vy**2 + posvel.vz**2);
      const dMoon = Math.sqrt((posvel.x-posvelM.x)**2 + (posvel.y-posvelM.y)**2 + (posvel.z-posvelM.z)**2);
      // const dMoon = 0;

      document.getElementById('telem-alt').textContent  = alt > 0 ? alt.toLocaleString('en',{maximumFractionDigits:0}) + ' km' : '—';
      document.getElementById('telem-moon').textContent = dMoon.toLocaleString('en',{maximumFractionDigits:0}) + ' km';
      document.getElementById('telem-speed').textContent  = speed.toFixed(2) + ' km/s';

    } else {

      // Hide plotly spacecraft position, trail and telemetry
      fig.data[traceIdx["pastTrail"]].visible = false;
      fig.data[traceIdx["craft"]].visible = false;
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
  
  // Update events
  renderNextEvent(time);
  renderEvents(time);

  // Batch apply all Plotly updates
  // const liveCamera = getLiveCamera();
  // if (liveCamera && !isDragging) layout.scene.camera = liveCamera;
  if (!isDragging) Plotly.react('plot', fig.data, layout);
  // Plotly.react('plot', fig.data, layout);

}

// ===============================================================
// UI CONTROLS
// ===============================================================

function startPlay() {
  playing = true;
  lastFrame = Date.now();
  btnPlay.textContent = '⏸ PAUSE';
  btnPlay.classList.add('active');
  rafId = requestAnimationFrame(rafLoop);
}

function stopPlay() {
  playing = false;
  live = false;
  btnPlay.textContent = '▶ PLAY';
  btnPlay.classList.remove('active');
  btnLive.classList.remove('active');
  if (rafId) cancelAnimationFrame(rafId);
}

function goLive() {
  live = true;
  btnLive.classList.add('active');
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

async function setRefFrame(_refFrame) {
  
  refFrame = _refFrame;

  if (!(refFrame in all_dataS) || !(refFrame in all_dataM)) {
    await loadData(refFrame);
  }
  dataS = all_dataS[refFrame];
  times = dataS.t;
  N = times.length;
  if (refFrame == "FRAME_FLYBY") {
    all_dataM[refFrame] = {t: [dataS.t[0], dataS.t[N-1]], x: [0, 0], y: [0, 0], z: [0, 0], vx: [0, 0], vy: [0, 0], vz: [0, 0]}
  }
  dataM = all_dataM[refFrame];
  tDataStart = times[0].getTime();
  tDataEnd = times[N-1].getTime();
  
  createPlot();
  
  // Re-set camera on frame change
  if (refFrame == "FRAME_FLYBY") {
    camera = {
      eye: {x: 0, y: 0, z: 0.3},
      up: {x: 0, y: 0, z: 1},
      center: {x: 0, y: 0, z: 0}
    };
  } else {
    camera = {
      center: { x: -0.07695509380516573, y: -0.19977415881095667, z: 0 },
      eye: { x: -0.07695509380516576, y: -0.19977415881095667, z: 0.5581923634002892 },
      up: {x: 0, y: 0, z: 1}
    };
    console.log(camera);
  }
  layout.scene.camera = camera;
  Plotly.relayout('plot', {'scene.camera': camera});

  frameSel.value = refFrame;

  updateMain(curTime);

}

// ===============================================================
// INITIALIZATION
// ===============================================================

async function init() {

  fig = document.getElementById('plot');

  refFrame = defaultFrame;

  // Load and parse events from JSON file
  const _response = await fetch('data/events.json');
  const events_json = await _response.json();
  milestones = Object.fromEntries(
    Object.entries(events_json.milestones).map(([name, isostr]) => {
      date = new Date(isostr);
      return [name, {"time": date.getTime(), "Date": date, "isostr": isostr}];
    })
  );
  const _events = events_json.events.map(ev => {
    date = new Date(ev.isostr);
    return {"time": date.getTime(), "Date": date, "isostr": ev.isostr, "name": ev.name}
  })
  events = _events.sort((a, b) => a.time - b.time);
  tLaunch = milestones["LAUNCH"].time;
  tEnd = milestones['MISSION_END'].time;

  // Create mesh spheres for the Earth and Moon
  es = genSphereSurface(0, 0, 0, EARTH_R, 32);
  ms0 = genSphereSurface(0, 0, 0, MOON_R, 16);
  mSOI0 = genSphereSurface(0, 0, 0, MOON_SOI_R, 32)

  // Init UI elements
  eventsList = document.getElementById('events-list');
  scrubber  = document.getElementById('scrubber');
  btnPlay   = document.getElementById('btn-play');
  btnLive     = document.getElementById('btn-live');
  speedSel  = document.getElementById('speed-select');
  frameSel  = document.getElementById('frame-select');
  cdDisplay = document.getElementById('countdown-display');
  clockDsp  = document.getElementById('clock-display');
  notesDiv  = document.getElementById('notes-div');

  // Frame control listener
  frameSel.addEventListener('change', (event) => {
    value = event.target.value;
    console.log('Selected frame:', value);
    setRefFrame(value);
  });

  // Time controls listeners
  btnPlay.addEventListener('click', () => { playing ? stopPlay() : startPlay(); });
  btnLive.addEventListener('click', goLive);
  scrubber.addEventListener('input', updateFromScrubber);

  notesDiv.innerHTML = `Data from ${events_json.source} (${events_json.rev_date}) • By meithan cc-by-sa`;

  // Load default state
  curTime = Date.now();
  await setRefFrame(defaultFrame);
  scrollToNextEvent(curTime);
  goLive();


  // View dragging workaround 
  isDragging = false;
  canvas = document.querySelector('#plot canvas');
  canvas.addEventListener('mousedown', () => isDragging = true);
  window.addEventListener('mouseup', () => isDragging = false);

}

const initPromise = init();