// Shared scenario + station switcher. Every station mockup shows the same moment aboard Fathom.
const STATIONS = [
  { id: 'captain', file: 'captain.html', name: 'Captain', seat: '1' },
  { id: 'sonar', file: '../submarine-sonar/index.html', name: 'Sonar', seat: '1' },
  { id: 'comms', file: 'comms.html', name: 'Comms', seat: '1' },
  { id: 'nav', file: 'nav.html', name: 'Navigator', seat: '1' },
  { id: 'helm', file: 'helm.html', name: 'Helm', seat: '1' },
  { id: 'weapons', file: 'weapons.html', name: 'Fire control', seat: 'WPN 1' },
  { id: 'torpedo', file: 'torpedo-room.html', name: 'Torpedo room / gun', seat: 'WPN 2' },
  { id: 'power', file: 'eng-power.html', name: 'Power', seat: 'ENG 1' },
  { id: 'life', file: 'eng-life.html', name: 'Life support', seat: 'ENG 2' },
  { id: 'damage', file: 'eng-damage.html', name: 'Damage control', seat: 'ENG 3' },
];

const SHIP = {
  name: 'FATHOM', time: '0347Z', propulsion: 'diesel-electric',
  course: 45, speed: 8, depth: 150, layer: 250, bottom: 1380,
  battery: 58, o2: 19.6, co2: 0.9, crew: 10,
  contacts: [
    { id: 'S1', kind: 'merchant', brg: 82, kyd: 12.4, course: 270, speed: 14, depth: 0, sol: 0.8 },
    { id: 'S2', kind: 'fishing', brg: 331, kyd: 6.1, course: 120, speed: 5, depth: 0, sol: 0.9 },
    { id: 'S3', kind: 'submarine', brg: 194, kyd: 8.8, course: 20, speed: 5, depth: 520, sol: 0.55, hostile: true },
  ],
  waypoint: { id: 'KILO', brg: 52, nm: 14.2, eta: '0532Z' },
  broadcast: { next: '0400Z', needDepth: 60 },
  tubes: [
    { n: 1, load: 'Heavyweight torpedo', state: 'flooded' },
    { n: 2, load: 'Heavyweight torpedo', state: 'dry' },
    { n: 3, load: 'Decoy', state: 'dry' },
    { n: 4, load: null, state: 'reloading', pct: 40 },
  ],
  damage: { where: 'Motor room', what: 'Shaft seal leak', rate: '4 gal/min' },
};

(function nav() {
  const here = document.body.dataset.station;
  const el = document.createElement('nav');
  el.className = 'stations';
  el.setAttribute('aria-label', 'Crew stations');
  el.innerHTML = `<a class="home" href="index.html"${here === 'home' ? ' aria-current="page"' : ''}>FATHOM</a>` +
    STATIONS.map(s => `<a href="${s.file}"${s.id === here ? ' aria-current="page"' : ''}>${s.name}<small>${s.seat === '1' ? '' : s.seat}</small></a>`).join('');
  document.body.prepend(el);
  el.querySelector('[aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
})();
