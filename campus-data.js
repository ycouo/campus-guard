/* =====================================================================
   校园安全区域数据 + 安全判定逻辑
   index.html（用户端）与 campus.html（校园安全地图）共用本文件

   【坐标说明】下面所有坐标都是 GCJ-02（火星坐标），来自腾讯地图公开数据。
   手机 GPS 直接给出的是 WGS-84 坐标，两者在国内相差几百米，
   因此必须先做坐标换算再计算距离，否则"是否在校内"会判错。

   【多校区】大工有多个校区，间隔数十公里，这里全部收录；
   默认优先开发区校区，程序也会自动挑选离你最近的校区做判定。
   换学校用：只改下面的 CAMPUSES 数组即可，其余代码不用动。
   ===================================================================== */

/* ---------- 一、校区配置 ---------- */
const CAMPUSES = [
  {
    id: 'kfq',
    name: '开发区校区',
    addr: '大连市金普新区图强路321号',
    center: { lat: 39.084533, lng: 121.816747 },   /* 腾讯地图公开数据 */
    radius: 650,                                    /* 校内判定半径（米） */
    hotline: '0411-87563110',                       /* 保卫处报警电话（官网公开） */
    points: [
      { name: '校区南门',   lat: 39.080820, lng: 121.816638, type: 'gate', phone: '' },
      { name: '校区北1门',  lat: 39.087069, lng: 121.816344, type: 'gate', phone: '' },
      { name: '校区总机',   lat: 39.084533, lng: 121.816747, type: 'safe', phone: '0411-62274467' }
    ]
  },
  {
    id: 'ls',
    name: '凌水主校区',
    addr: '大连市甘井子区凌工路2号',
    center: { lat: 38.883446, lng: 121.525182 },
    radius: 1200,
    hotline: '0411-84708110',
    points: [
      { name: '保卫处（24小时报警）', lat: 38.881158, lng: 121.528762, type: 'safe', phone: '0411-84708110' },
      { name: '校医院',               lat: 38.880298, lng: 121.524946, type: 'safe', phone: '0411-84708990' },
      { name: '主楼',                 lat: 38.879577, lng: 121.528042, type: 'safe', phone: '' },
      { name: '南门',                 lat: 38.874971, lng: 121.531818, type: 'gate', phone: '' },
      { name: '东门',                 lat: 38.878435, lng: 121.533198, type: 'gate', phone: '' },
      { name: '北门',                 lat: 38.887173, lng: 121.530870, type: 'gate', phone: '' },
      { name: '西南门',               lat: 38.878393, lng: 121.527007, type: 'gate', phone: '' },
      { name: '西门',                 lat: 38.885251, lng: 121.514866, type: 'gate', phone: '' },
      { name: '西北门',               lat: 38.885955, lng: 121.524381, type: 'gate', phone: '' }
    ]
  }
];

/* 默认校区：开发区（用户本人所在校区） */
const DEFAULT_CAMPUS_ID = 'kfq';

/* 夜间时段：22:00 - 次日 6:00（此时段风险权重更高） */
const NIGHT_START = 22, NIGHT_END = 6;

/* ---------- 二、坐标与距离工具 ---------- */
/* WGS-84 → GCJ-02（手机 GPS 坐标 → 国内地图坐标） */
function cgWgsToGcj(lat, lng) {
  const a = 6378245.0, ee = 0.00669342162296594323;
  function tLat(x, y) {
    let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
    r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI)) * 2/3;
    r += (20*Math.sin(y*Math.PI) + 40*Math.sin(y/3*Math.PI)) * 2/3;
    r += (160*Math.sin(y/12*Math.PI) + 320*Math.sin(y*Math.PI/30)) * 2/3;
    return r;
  }
  function tLng(x, y) {
    let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
    r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI)) * 2/3;
    r += (20*Math.sin(x*Math.PI) + 40*Math.sin(x/3*Math.PI)) * 2/3;
    r += (150*Math.sin(x/12*Math.PI) + 300*Math.sin(x/30*Math.PI)) * 2/3;
    return r;
  }
  const dLat = tLat(lng-105, lat-35), dLng = tLng(lng-105, lat-35);
  const radLat = lat/180*Math.PI;
  let magic = Math.sin(radLat); magic = 1 - ee*magic*magic;
  const sq = Math.sqrt(magic);
  return {
    lat: lat + (dLat*180) / ((a*(1-ee)) / (magic*sq) * Math.PI),
    lng: lng + (dLng*180) / (a/sq*Math.cos(radLat)*Math.PI)
  };
}
/* 两点的球面距离（米） */
function cgDist(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = function (d) { return d * Math.PI / 180; };
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLng/2)*Math.sin(dLng/2);
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}
/* 是否夜间时段 */
function isNightTime(t) {
  const h = (t ? new Date(t) : new Date()).getHours();
  return h >= NIGHT_START || h < NIGHT_END;
}

/* ---------- 三、当前校区（用户可手动切换，也可按位置自动识别） ----------
   优先级：手动选择 > 自动识别 > 默认校区。
   拆分这两个函数是为了让上层能区分「用户有没有手动选过」——
   没选过就该老实自动识别，别自作主张套默认校区。 */
const LS_CAMPUS = 'cg_campus';
function getCampusId() { return localStorage.getItem(LS_CAMPUS); }
function setCampusId(id) { localStorage.setItem(LS_CAMPUS, id); }
function getCampus(id) {
  const cid = id || getCampusId() || DEFAULT_CAMPUS_ID;
  return CAMPUSES.filter(function (c) { return c.id === cid; })[0] || CAMPUSES[0];
}
/* 根据坐标自动挑选最近的校区 */
function nearestCampus(gcjLat, gcjLng) {
  let best = null;
  CAMPUSES.forEach(function (c) {
    const d = cgDist(gcjLat, gcjLng, c.center.lat, c.center.lng);
    if (!best || d < best.dist) best = { campus: c, dist: d };
  });
  return best;
}

/* ---------- 四、用户自己标记的点（只存在本机） ---------- */
const LS_RISKS = 'cg_risks';    /* 危险点 */
const LS_UPNTS = 'cg_upoints';  /* 自己补充的安全点 */
function cgLoad(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
function cgSave(key, arr) { localStorage.setItem(key, JSON.stringify(arr)); }
function getRisks() { return cgLoad(LS_RISKS); }
function addRisk(lat, lng, note) {
  const arr = getRisks();
  arr.push({ lat: lat, lng: lng, note: note || '', time: new Date().toISOString() });
  cgSave(LS_RISKS, arr);
}
function clearRisks() { cgSave(LS_RISKS, []); }
function getUserPoints() { return cgLoad(LS_UPNTS); }
function addUserPoint(lat, lng, name) {
  const arr = getUserPoints();
  arr.push({ lat: lat, lng: lng, name: name || '我添加的安全点', type: 'safe', phone: '' });
  cgSave(LS_UPNTS, arr);
}
function clearUserPoints() { cgSave(LS_UPNTS, []); }

/* ---------- 五、核心：根据定位判断当前是否安全 ----------
   判定思路（不依赖任何地图服务和网络，纯本地计算）：
   ① 在哪个校区的范围内      ② 离最近的可求助点有多远
   ③ 是不是夜间时段          ④ 是否踩进自己标记过的危险点
   四个条件组合出三档结论：安全 / 注意 / 危险
------------------------------------------------------------ */
function judgeSafety(latWgs, lngWgs, campusId) {
  const g = cgWgsToGcj(latWgs, lngWgs);           /* 先换算到 GCJ-02，保证与校园数据同一坐标系 */
  const night = isNightTime();

  /* 1. 判定校区
     传了 campusId → 用户在地图上手动选的，按他选的算（尊重显式意图）
     没传       → 自动挑最近的。守护报警判定必须走这条路：
                  安全结论要基于真实位置，用户手滑选错校区不该把人判成"在校外"而误报警。 */
  const nc = nearestCampus(g.lat, g.lng);
  const auto = !campusId;
  const picked = campusId && CAMPUSES.filter(function (x) { return x.id === campusId; })[0];
  const campus = picked || nc.campus;
  /* 距离要对「实际采用的这个校区」重算：手动指定后，nc.dist 算的是另一个校区，不能直接用 */
  const dCenter = campus === nc.campus ? nc.dist : cgDist(g.lat, g.lng, campus.center.lat, campus.center.lng);
  const inCampus = dCenter <= campus.radius;
  /* 用户手选的校区和实际所在校区不一致时提示一下（常见于跨校区看地图） */
  const mismatch = (!auto && picked && nc.campus.id !== picked.id) ? nc.campus : null;

  /* 2. 最近的可求助点（该校区的保卫处、校医院、校门 + 用户自己补的点） */
  const all = campus.points.concat(getUserPoints());
  let nearest = null;
  all.forEach(function (p) {
    const d = cgDist(g.lat, g.lng, p.lat, p.lng);
    if (!nearest || d < nearest.dist) nearest = { name: p.name, dist: d, type: p.type, phone: p.phone, lat: p.lat, lng: p.lng };
  });

  /* 3. 是否在自己标记的危险点附近（200 米内） */
  let nearRisk = null;
  getRisks().forEach(function (r) {
    const d = cgDist(g.lat, g.lng, r.lat, r.lng);
    if (d <= 200 && (!nearRisk || d < nearRisk.dist)) nearRisk = { dist: d, note: r.note };
  });

  /* 4. 综合判定 */
  const reasons = [];
  let level = 'safe';
  if (nearRisk) { level = 'danger'; reasons.push('位于你标记过的危险点附近 ' + nearRisk.dist + ' 米'); }
  if (!inCampus) {
    reasons.push('在校外，距' + campus.name + '约 ' + (dCenter/1000).toFixed(1) + ' 公里');
    if (night && nearest.dist > 600) level = 'danger';
    else if (level !== 'danger') level = 'warn';
  }
  if (night) {
    reasons.push('夜间时段（22:00-06:00）');
    if (inCampus && nearest.dist > 500 && level === 'safe') level = 'warn';
  }
  if (nearest.dist > 1500) { level = 'danger'; reasons.push('周边 1.5 公里内没有可求助点'); }
  else if (nearest.dist > 800 && level === 'safe') level = 'warn';

  const summary = campus.name + '·' + (inCampus ? '校内' : '校外') + (night ? ' · 夜间' : '') +
                  ' · 最近求助点「' + nearest.name + '」约 ' + nearest.dist + ' 米';

  const MAP = {
    safe:   { title: '当前位置相对安全', advice: '附近有可求助点。夜间建议走照明好的主路，尽量结伴。' },
    warn:   { title: '请注意周围环境',   advice: '你所在位置离求助点较远或已在夜间时段。建议尽快往亮处、人多的地方走，或让室友实时看你的位置。' },
    danger: { title: '当前位置风险较高', advice: '建议立刻移动到就近的校门或保卫处；如感觉被跟踪，直接使用静默报警，手机不会发出声音。' }
  };
  return {
    level: level, title: MAP[level].title, advice: MAP[level].advice,
    campus: campus, inCampus: inCampus, night: night, nearest: nearest,
    nearRisk: nearRisk, reasons: reasons, summary: summary, gcj: g,
    auto: auto, mismatch: mismatch   /* auto=是否自动识别；mismatch=实际所在的其他校区 */
  };
}
