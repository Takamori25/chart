import { createChart, CandlestickSeries, LineSeries, HistogramSeries, AreaSeries } from 'lightweight-charts';

let currentInterval = '4h';
let currentSymbol = 'BTCUSDT';
let currentPrice = '';
let isDrawingFibo = false;
let fiboStart = null;
let fiboEnd = null;
const fiboLines = [];
const fiboLabels = []; // Global
let fiboClickHandler = null; // biến toàn cục để lưu callback
let timerClickHandler = null;
let tempLine = null;
let tempCircle = null;
let moveHandler = null;

let isDrawingTrendline = false;
let trendStart = null;
let trendEnd = null;
let trendTempLine = null;
let trendLineSeries = [];
let trendStartCircle = null;
let trendMoveHandler = null;
let trendClickHandler = null;

let timeoutId = null;
let isAutoRunning = true;
let selectTime = null;

const container = document.getElementById('chart-container');
const chart = createChart(container, {
  autoSize: true,
  layout: { background: { color: '#fff' }, textColor: '#000' },
  crosshair: {
    mode: 0,
    vertLine: {
      visible: true,
      width: 1,
      color: '#888',
      style: 3,
      labelVisible: true,
    },
    horzLine: {
      visible: true,
      width: 1,
      color: '#888',
      style: 3,
      labelVisible: true,
    },
  },
});

chart.applyOptions({
  autoScale: false,
  localization: {
    timeFormatter: (time) => {
      const date = new Date((time + 7) * 1000);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      if (['1h', '2h', '4h', '6h', '8h', '12h', '15m', '30m', '5m', '1m'].includes(currentInterval)) {
        return `${hours}:${minutes} ${day}/${month}/${year}`;;
      }
      if (currentInterval === '1d' || currentInterval === '3d' || currentInterval === '1w' || currentInterval === '2w' || currentInterval === '1M') {
        return `${date.getDate()}/${date.getMonth() + 1}/${year}`;
      }
    }
  }
});

chart.timeScale().applyOptions({
  timeVisible: true,
  tickMarkFormatter: (time, tickMarkType, locale) => {
    const date = new Date((time + 7) * 1000);

    if (['1h', '2h', '4h', '6h', '8h', '12h', '15m', '30m', '5m', '1m'].includes(currentInterval)) {
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes()
        .toString()
        .padStart(2, '0')} ${date.getDate()}/${date.getMonth() + 1}`;
    }

    if (currentInterval === '1d' || currentInterval === '3d' || currentInterval === '1w' || currentInterval === '2w' || currentInterval === '1M') {
      return `${date.getDate()}/${date.getMonth() + 1}`;
    }

    return `${date.getMonth() + 1}/${date.getFullYear()}`;
  },
});

const pane2 = chart.addPane();

async function fetchKlines(interval, symbol = 'BTCUSDT', limit = 3000, endTime) {
  let url = ``
  if (isAutoRunning || !endTime) {
    url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  } else {
    url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&endTime=${endTime}&limit=${limit}`;
  }
  
  const resp = await fetch(url);
  const data = await resp.json();
  return data.map(d => ({
    time: Math.floor(d[0] / 1000),
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
  }));
}

function resetChartView() {
  const totalBars = latestDataLength;
  const visibleBars = 150;
  const offsetRight = 10;

  if (totalBars < visibleBars) return; // tránh lỗi nếu dữ liệu chưa đủ

  chart.timeScale().setVisibleLogicalRange({
    from: totalBars - visibleBars,
    to: totalBars + offsetRight,
  });
  // Bật autoScale để resize trục theo dữ liệu mới
  priceSeries.priceScale().setAutoScale(true);
  if (isAutoRunning) {
    handleChartData(currentInterval, currentSymbol)
  } else {
    handleChartData(currentInterval, currentSymbol, 3000, selectTime)
  }
}

function mergeCandles(data, groupSize) {
  const merged = [];
  for (let i = 0; i < data.length; i += groupSize) {
    const group = data.slice(i, i + groupSize);
    if (group.length < groupSize) break;
    merged.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + (c.volume ?? 0), 0),
    });
  }
  return merged;
}


function calculateRSI(closes, times, period = 14) {
  const rsis = [];
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  rsis[period] = avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsis[i] = avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsis.map((r, i) => r !== undefined ? { time: times[i], value: r } : null).filter(Boolean);
}

function calculateEMA(data, length) {
  const ema = [];
  const k = 2 / (length + 1);
  ema[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    ema[i] = data[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function calculateWMA(data, length) {
  const wma = [];
  const denom = (length * (length + 1)) / 2;
  for (let i = length - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < length; j++) {
      sum += data[i - j] * (length - j);
    }
    wma[i] = sum / denom;
  }
  return wma;
}

const priceSeries = chart.addSeries(CandlestickSeries, {
  upColor: '#fff',          // màu thân nến tăng
  downColor: '#000',        // màu thân nến giảm
  borderUpColor: '#000',    // màu viền nến tăng
  borderDownColor: '#000',  // màu viền nến giảm
  wickUpColor: '#000',      // màu râu nến tăng
  wickDownColor: '#000',    // màu râu nến giảm
  priceLineVisible: true,
  priceLineColor: 'black', // màu đen
  priceLineStyle: 2        // nét đứt (0: liền, 1: chấm, 2: đứt, 3: chấm - đứt, v.v.)
});
let latestDataLength = 0;

const rsi80To90 = pane2.addSeries(AreaSeries, {
  topColor: '#e9f5e9',  // Màu nền bạn muốn
  bottomColor: '#e9f5e9',
  lineColor: 'rgba(0,0,0,0)',
  lineWidth: 0,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false
});

const rsi60To80 = pane2.addSeries(AreaSeries, {
  topColor: '#e5ddf3',  // Màu nền bạn muốn
  bottomColor: '#e5ddf3',
  lineColor: 'rgba(0,0,0,0)',
  lineWidth: 0,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false
});

const rsi40To60 = pane2.addSeries(AreaSeries, {
  topColor: '#f2eef9',  // Màu nền bạn muốn
  bottomColor: '#f2eef9',
  lineColor: 'rgba(0,0,0,0)',
  lineWidth: 0,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false
});

const rsi20To40 = pane2.addSeries(AreaSeries, {
  topColor: '#e5ddf3',  // Màu nền bạn muốn
  bottomColor: '#e5ddf3',
  lineColor: 'rgba(0,0,0,0)',
  lineWidth: 0,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false
});

const rsi10To20 = pane2.addSeries(AreaSeries, {
  topColor: '#fff9f0',  // Màu nền bạn muốn
  bottomColor: '#fff9f0',
  lineColor: 'rgba(0,0,0,0)',
  lineWidth: 0,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false
});

const rsi0To10 = pane2.addSeries(AreaSeries, {
  topColor: '#ffffff',  // Màu nền bạn muốn
  bottomColor: '#ffffff',
  lineColor: 'rgba(0,0,0,0)',
  lineWidth: 0,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false
});

// Histogram để vẽ nền vùng RSI
const zoneHigh = pane2.addSeries(HistogramSeries, { color: '#66bb6a80', priceFormat: { type: 'volume' }, lastValueVisible: false, crosshairMarkerVisible: false });
const zoneLow = pane2.addSeries(HistogramSeries, { color: '#ff980080', priceFormat: { type: 'volume' }, lastValueVisible: false, crosshairMarkerVisible: false });

const rsiSeries = pane2.addSeries(LineSeries, { color: 'purple', lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false });
const emaSeries = pane2.addSeries(LineSeries, { color: 'green', lineWidth: 1, priceLineVisible: false, crosshairMarkerVisible: false });
const wmaSeries = pane2.addSeries(LineSeries, { color: 'blue', lineWidth: 1, priceLineVisible: false, crosshairMarkerVisible: false });

function generateWhitespace(data, intervalStr) {
  const futureWhiteSpace = [];
  const lastCandleTime = data[data.length - 1].time;
  const interval = intervalToSeconds(intervalStr);
  for (let i = 1; i <= 50; i++) {
    futureWhiteSpace.push({ time: lastCandleTime + i * interval });
  }
  return futureWhiteSpace;
}

function intervalToSeconds(intervalStr) {
  const num = parseInt(intervalStr);
  if (intervalStr.endsWith('s')) return num;
  if (intervalStr.endsWith('m')) return num * 60;
  if (intervalStr.endsWith('h')) return num * 3600;
  if (intervalStr.endsWith('d')) return num * 86400;
  if (intervalStr.endsWith('w')) return num * 604800;
  if (intervalStr.endsWith('M')) return num * 2592000;
  return 3600;
}


async function handleChartData(interval, symbol, limit, endTime) {
  if (interval !== currentInterval || symbol !== currentSymbol) {
    // Bật autoScale để resize trục theo dữ liệu mới
    priceSeries.priceScale().setAutoScale(true);
  }
  currentInterval = interval;
  currentSymbol = symbol;
  let baseInterval = interval;
  let groupSize = 1;

  // Gộp nến 3D từ 1D hoặc 2W từ 1W
  if (interval === '3d') {
    baseInterval = '1d';
    groupSize = 3;
  } else if (interval === '2w') {
    baseInterval = '1w';
    groupSize = 2;
  }

  let candleData = null;
  if (isAutoRunning) {
    const rawData = await fetchKlines(baseInterval, symbol, limit);
    candleData = (groupSize === 1) ? rawData : mergeCandles(rawData, groupSize);
  } else {
    let miliSecondEndTime = endTime * 1000;
    const rawData = await fetchKlines(baseInterval, symbol, limit, miliSecondEndTime);
    candleData = (groupSize === 1) ? rawData : mergeCandles(rawData, groupSize);
  }
  priceSeries.setData(candleData);
  // thêm whiteData
  const futureWhiteSpace = generateWhitespace(candleData, interval);
  priceSeries.setData([...candleData, ...futureWhiteSpace]);
  latestDataLength = candleData.length;
  currentPrice = candleData[latestDataLength - 1].close
  const closes = candleData.map(c => c.close);
  const times = candleData.map(c => c.time);

  const rsiData = calculateRSI(closes, times, 14);
  const emaData = calculateEMA(rsiData.map(d => d.value), 9);
  const wmaData = calculateWMA(rsiData.map(d => d.value), 45);

  const rsiEMA9 = rsiData.map((d, i) => ({ time: d.time, value: emaData[i] })).filter(d => d.value !== undefined);
  const rsiWMA45 = rsiData.map((d, i) => ({ time: d.time, value: wmaData[i] })).filter(d => d.value !== undefined);

  // Vẽ các vùng nền
  const zHigh = [], zLow = [];
  rsiData.forEach(d => {
    if (d.value >= 80) zHigh.push({ time: d.time, value: 100 });
    else zHigh.push({ time: d.time, value: 0 });

    if (d.value <= 20) zLow.push({ time: d.time, value: 100 });
    else zLow.push({ time: d.time, value: 0 });
  });

  // Tạo vùng nền giữa
  const rsiZone80To90 = rsiData.map(d => ({
    time: d.time,
    value: 90,  // Đường trên là 90
  }));

  const rsiZone60To80 = rsiData.map(d => ({
    time: d.time,
    value: 80,  // Đường trên là 80
  }));

  const rsiZone40To60 = rsiData.map(d => ({
    time: d.time,
    value: 60,  // Đường trên là 60
  }));

  const rsiZone20To40 = rsiData.map(d => ({
    time: d.time,
    value: 40,  // Đường trên là 40
  }));

  const rsiZone10To20 = rsiData.map(d => ({
    time: d.time,
    value: 20,  // Đường trên là 20
  }));

  const rsiZone0To10 = rsiData.map(d => ({
    time: d.time,
    value: 10,  // Đường trên là 10
  }));

  rsi80To90.setData(rsiZone80To90);
  rsi60To80.setData(rsiZone60To80);
  rsi40To60.setData(rsiZone40To60);
  rsi20To40.setData(rsiZone20To40);
  rsi10To20.setData(rsiZone10To20);
  rsi0To10.setData(rsiZone0To10);
  zoneHigh.setData(zHigh);
  zoneLow.setData(zLow);
  rsiSeries.setData(rsiData);
  emaSeries.setData(rsiEMA9);
  wmaSeries.setData(rsiWMA45);

  // Sau đó tắt autoScale để giữ scale y trong tương tác người dùng
  priceSeries.priceScale().setAutoScale(false);

  chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    chart.timeScale().setVisibleLogicalRange(range);
  });

  priceSeries.priceScale().applyOptions({
    autoScale: false,
  });
  rsiSeries.priceScale().applyOptions({
    autoScale: true,
    scaleMargins: { top: 0, bottom: 0 },
    minValue: 0,
    maxValue: 100,
  });
  emaSeries.priceScale().applyOptions({
    autoScale: true,
    scaleMargins: { top: 0, bottom: 0 },
    minValue: 0,
    maxValue: 100,
  });
  wmaSeries.priceScale().applyOptions({
    autoScale: true,
    scaleMargins: { top: 0, bottom: 0 },
    minValue: 0,
    maxValue: 100,
  });
}

[70, 30].forEach(level => {
  rsiSeries.createPriceLine({
    price: level,
    color: 'white',
    lineWidth: 3,
    lineStyle: 0,
    axisLabelVisible: false,
    title: level.toString(),
  });
});

handleChartData('4h')

window.handleSelectTimeFrame = function (buttonElement) {
  if (buttonElement) {
    const intervalAttr = buttonElement.getAttribute('data-interval');
    const intervalDisplay = document.getElementById('current-interval');
    if (intervalAttr) {
      intervalDisplay.textContent = intervalAttr;
      if (isAutoRunning) {
        handleChartData(intervalAttr, currentSymbol)
      } else {
        handleChartData(intervalAttr, currentSymbol, 3000, selectTime)
      }
    }
  }
}

let exchangeInfoCache = null;

async function loadExchangeInfo() {
  if (!exchangeInfoCache) {
    const res = await fetch('https://api.binance.com/api/v3/exchangeInfo');
    const info = await res.json();
    exchangeInfoCache = info.symbols;
  }
  return exchangeInfoCache;
}

async function getPrecisionAndTick(symbol) {
  const symbols = await loadExchangeInfo();
  const sym = symbols.find(s => s.symbol === symbol);
  if (!sym) return { precision: 6, tickSize: 1 };
  const pf = sym.filters.find(f => f.filterType === 'PRICE_FILTER');
  const tickSize = parseFloat(pf.tickSize);
  const precision = Math.round(-Math.log10(tickSize));
  return { precision, tickSize };
}

window.handleSelectSymbol = async function (symbolElement) {
  if (symbolElement) {
    const symbolAttr = symbolElement.getAttribute('data-symbol')
    const symbolDisplay = document.getElementById('current-symbol');

    if (symbolAttr) {
      const { precision, tickSize } = await getPrecisionAndTick(symbolAttr);
      priceSeries.applyOptions({
        priceFormat: {
          type: 'price',
          precision,
          minMove: tickSize
        }
      });
      symbolDisplay.textContent = symbolAttr;
      
      if (isAutoRunning) {
        await handleChartData(currentInterval, symbolAttr)
      } else {
        await handleChartData(currentInterval, symbolAttr, 3000, selectTime)
      }
      const currentPriceDisplay = document.getElementById('last-price');
      currentPriceDisplay.textContent = currentPrice;
      const tabDisplay = document.getElementById('tab-display');
      tabDisplay.textContent = currentPrice;
    }
  }
}

window.handleResetChartView = function () {
  resetChartView();
}

async function fetchLastPrice(symbol) {
  const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
  const data = await res.json();
  return parseFloat(data.price);
}

async function scheduleHandle() {
  // Nếu không bật auto thì thoát (đề phòng nếu bị gọi thủ công)
  const selectBarElement = document.querySelector('.select-bar-btn')
  selectBarElement.disabled = true;
  if (!isAutoRunning) return;
  await handleChartData(currentInterval, currentSymbol);
  const currentPriceDisplay = document.getElementById('last-price');
  const tabDisplay = document.getElementById('tab-display');
  currentPriceDisplay.textContent = currentPrice;
  tabDisplay.textContent = currentPrice;
  for (let i = 1; i < 9; i++) {
    const tbody = document.querySelector('#price-table tbody');
    const row = tbody.querySelector(`tr:nth-child(${i})`);
    const td = row.querySelector('td:nth-child(2)');
    const symbolAttr = row.getAttribute('data-symbol');
    td.textContent = await fetchLastPrice(symbolAttr);
  }
  // Lên lịch lần tiếp theo nếu vẫn bật
  timeoutId = setTimeout(scheduleHandle, 20000);
}

scheduleHandle(); // Gọi lần đầu

window.handleReplay = () => {
  let Replaybtn = document.querySelector('.replay-btn')
  const selectBarElement = document.querySelector('.select-bar-btn')
  selectBarElement.disabled = false;
  if (isAutoRunning) {
    // Nếu đang chạy → dừng lại
    isAutoRunning = false;
    clearTimeout(timeoutId);
    Replaybtn.textContent = 'Off Replay';
    Replaybtn.style.backgroundColor = 'orange';
     
    chart.applyOptions({
        crosshair: {
          vertLine: {
            color: '#2962ff',
            width: 2,
            style: 0,
          },
          horzLine: {
            visible: false,
          },
        },
      });
    
    // Bắt sự kiện click để lấy nến & reset line
    timerClickHandler = param => {
      if (!param.time) return;
      chart.applyOptions({
        crosshair: {
          vertLine: {
            color: '#888',
            width: 1,
            style: 3,
          },
          horzLine: {
            visible: true,
            color: '#888',
            width: 1,
          },
        },
      });
      const endTime = param.time;
      selectTime = param.time;
      // Hủy sự kiện sau khi click
      chart.unsubscribeClick(timerClickHandler);
      handleChartData(currentInterval, currentSymbol, 3000, endTime)
      const totalBars = latestDataLength;
      const visibleBars = 150;
      const offsetRight = 10;

      if (totalBars < visibleBars) return; // tránh lỗi nếu dữ liệu chưa đủ

      chart.timeScale().setVisibleLogicalRange({
        from: totalBars - visibleBars,
        to: totalBars + offsetRight,
      });
    };
    chart.subscribeClick(timerClickHandler);
 
  } else {
    // Nếu đang dừng → chạy lại
    isAutoRunning = true;
    Replaybtn.textContent = 'On Replay';
    Replaybtn.style.backgroundColor = 'white';
    chart.applyOptions({
      crosshair: {
        vertLine: {
          color: '#888',
          width: 1,
          style: 3,
        },
        horzLine: {
          visible: true,
          color: '#888',
          width: 1,
        },
      },
    });
    scheduleHandle();
    resetChartView();
  }
}

window.handleSelectBar = () => {
  chart.applyOptions({
        crosshair: {
          vertLine: {
            color: '#2962ff',
            width: 2,
            style: 0,
          },
          horzLine: {
            visible: false,
          },
        },
      });
    
    // Bắt sự kiện click để lấy nến & reset line
    timerClickHandler = param => {
      if (!param.time) return;
      chart.applyOptions({
        crosshair: {
          vertLine: {
            color: '#888',
            width: 1,
            style: 3,
          },
          horzLine: {
            visible: true,
            color: '#888',
            width: 1,
          },
        },
      });
      const endTime = param.time;
      selectTime = param.time;
      // Hủy sự kiện sau khi click
      chart.unsubscribeClick(timerClickHandler);
      handleChartData(currentInterval, currentSymbol, 3000, endTime)
      const totalBars = latestDataLength;
      const visibleBars = 150;
      const offsetRight = 10;

      if (totalBars < visibleBars) return; // tránh lỗi nếu dữ liệu chưa đủ

      chart.timeScale().setVisibleLogicalRange({
        from: totalBars - visibleBars,
        to: totalBars + offsetRight,
      });
    };
    chart.subscribeClick(timerClickHandler);
}

function drawFibonacci(start, end) {
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const high = Math.max(start.price, end.price);
  const low = Math.min(start.price, end.price);
  const tStart = start.time;
  const tEnd = end.time;
  const chartElement = document.getElementById('chart-container')

  levels.forEach(level => {
    const price = high - (high - low) * level;
    const line = chart.addSeries(LineSeries, {
      color: level === 0.5 ? 'red' : '#000',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });

    line.setData([
      { time: tStart, value: price },
      { time: tEnd, value: price }
    ]);

    const y = line.priceToCoordinate(price);
    const label = document.createElement('div');
    label.className = 'fibo-label';
    label.style.position = 'absolute';
    label.style.left = '5px';
    label.style.top = `${y - 8}px`;
    label.style.color = level === 0.5 ? 'red' : 'gray';
    label.style.fontSize = '12px';
    label.style.zIndex = '1000';
    label.style.pointerEvents = 'none';
    label.innerText = `${level}`;
    chartElement.appendChild(label);
    fiboLabels.push({ label, line, price, time: tStart });
    fiboLines.push(line);
  });
}

// Cập nhật vị trí label theo chart
function updateFiboLabelPositions() {
  fiboLabels.forEach(({ label, line, price, time }) => {
    const y = line.priceToCoordinate(price);
    const x = chart.timeScale().timeToCoordinate(time);
    if (y != null && x != null) {
      label.style.top = `${y - 7}px`;
      label.style.left = `${x - 30}px`; // +8px để lệch ra ngoài 1 chút
    } else {
      // Nếu label ra ngoài chart, ẩn nó
      label.style.display = 'none';
    }
  });
  requestAnimationFrame(updateFiboLabelPositions);
}

requestAnimationFrame(updateFiboLabelPositions); // Gọi 1 lần để bắt đầu


window.handleToggleFibo = () => {
  if (isDrawingTrendline) {
    handleToggleTrendline()
  }
  const btn = document.querySelector('.toggle-fibo');
  const chartElement = document.getElementById('chart-container');
  isDrawingFibo = !isDrawingFibo;

  if (isDrawingFibo) {
    btn.textContent = 'Off Fibo';
    btn.style.backgroundColor = 'orange';

    // Bắt đầu theo dõi chuột để vẽ đường tạm
    moveHandler = (e) => {
      if (!fiboStart) return;

      const rect = chartElement.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const time = chart.timeScale().coordinateToTime(mouseX);
      const price = priceSeries.coordinateToPrice(mouseY);
      if (!time || price === undefined) return;

      if (!tempLine) {
        tempLine = chart.addSeries(LineSeries, {
          color: 'rgba(0, 0, 255, 0.5)',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }

      if (time !== fiboStart.time) {
        tempLine.setData([
          { time: fiboStart.time, value: fiboStart.price },
          { time, value: price },
        ]);
      };
    }
    chartElement.addEventListener('mousemove', moveHandler);

    // Xử lý click chart
    fiboClickHandler = (param) => {
      const price = priceSeries.coordinateToPrice(param.point.y);
      const time = param.time;

      if (!fiboStart) {
        // Click lần đầu
        fiboStart = { time, price };

        // Vẽ chấm tròn đầu tiên
        if (tempCircle) tempCircle.remove();
        tempCircle = document.createElement('div');
        tempCircle.className = 'fibo-circle';
        tempCircle.style.position = 'absolute';
        tempCircle.style.width = '10px';
        tempCircle.style.height = '10px';
        tempCircle.style.borderRadius = '50%';
        tempCircle.style.backgroundColor = 'blue';
        tempCircle.style.zIndex = '1000';
        tempCircle.style.pointerEvents = 'none';

        const x = chart.timeScale().timeToCoordinate(time);
        const y = priceSeries.priceToCoordinate(price);
        if (x != null && y != null) {
          tempCircle.style.left = `${x - 5}px`;
          tempCircle.style.top = `${y - 5}px`;
          chartElement.appendChild(tempCircle);
        }

      } else {
        // Click lần thứ hai
        fiboEnd = { time, price };

        // Xóa đường tạm
        if (tempLine) {
          chart.removeSeries(tempLine);
          tempLine = null;
        }

        // Xóa chấm tròn
        if (tempCircle) {
          tempCircle.remove();
          tempCircle = null;
        }

        drawFibonacci(fiboStart, fiboEnd);

        // Reset
        fiboStart = null;
        fiboEnd = null;
      }
    };

    chart.subscribeClick(fiboClickHandler);
  } else {
    // Tắt chế độ vẽ Fibo
    btn.style.backgroundColor = '#fff';
    btn.textContent = 'On Fibo';

    if (fiboClickHandler) {
      chart.unsubscribeClick(fiboClickHandler);
      fiboClickHandler = null;
    }

    if (moveHandler) {
      chartElement.removeEventListener('mousemove', moveHandler);
      moveHandler = null;
    }

    if (tempLine) {
      chart.removeSeries(tempLine);
      tempLine = null;
    }

    if (tempCircle) {
      tempCircle.remove();
      tempCircle = null;
    }

    fiboStart = null;
    fiboEnd = null;
  }
};

window.handleDeletePreviousFibo = () => {
  if (isDrawingFibo) {
    handleToggleFibo()
  }
  fiboLines.slice(-7).forEach(line => chart.removeSeries(line));
  fiboLines.splice(-7, 7);
}

window.handleToggleTrendline = () => {
  if (isDrawingFibo) {
    handleToggleFibo()
  }
  const btn = document.querySelector('.toggle-trendline');
  isDrawingTrendline = !isDrawingTrendline;

  const chartElement = document.getElementById('chart-container');

  if (isDrawingTrendline) {
    btn.textContent = 'Off Trendline';
    btn.style.backgroundColor = 'orange';

    // Mouse move để vẽ đường tạm thời
    trendMoveHandler = e => {
      if (!trendStart) return;
      const rect = chartElement.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const time = chart.timeScale().coordinateToTime(mouseX);
      const price = priceSeries.coordinateToPrice(mouseY);

      if (!trendTempLine) {
        trendTempLine = chart.addSeries(LineSeries, {
          color: 'blue',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
      }

      if (time !== trendStart.time) {
        trendTempLine.setData([
          { time: trendStart.time, value: trendStart.price },
          { time, value: price }
        ]);
      }
    };
    chartElement.addEventListener('mousemove', trendMoveHandler);

    // Click chuột để lấy 2 điểm
    trendClickHandler = param => {
      const price = priceSeries.coordinateToPrice(param.point.y);
      const time = param.time;

      if (!trendStart) {
        trendStart = { time, price };

        // Vẽ chấm tròn đầu
        if (trendStartCircle) trendStartCircle.remove();
        trendStartCircle = document.createElement('div');
        trendStartCircle.className = 'trend-circle';
        trendStartCircle.style.cssText = `
          position: absolute;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background-color: blue;
          z-index: 1000;
          pointer-events: none;
        `;
        chartElement.appendChild(trendStartCircle);

        const x = chart.timeScale().timeToCoordinate(time);
        const y = priceSeries.priceToCoordinate(price);
        if (x != null && y != null) {
          trendStartCircle.style.left = `${x - 5}px`;
          trendStartCircle.style.top = `${y - 5}px`;
        }

      } else {
        trendEnd = { time, price };

        // Xóa đường tạm thời và chấm tròn
        if (trendTempLine) {
          chart.removeSeries(trendTempLine);
          trendTempLine = null;
        }
        if (trendStartCircle) {
          trendStartCircle.remove();
          trendStartCircle = null;
        }

        // Vẽ đường trendline cố định
        const finalLine = chart.addSeries(LineSeries, {
          color: 'blue',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });

        finalLine.setData([
          { time: trendStart.time, value: trendStart.price },
          { time: trendEnd.time, value: trendEnd.price }
        ]);

        trendLineSeries.push(finalLine);

        // Reset
        trendStart = null;
        trendEnd = null;
      }
    };

    chart.subscribeClick(trendClickHandler);

  } else {
    btn.textContent = 'On Trendline';
    btn.style.backgroundColor = '#fff';

    if (trendClickHandler) {
      chart.unsubscribeClick(trendClickHandler);
      trendClickHandler = null;
    }
    if (trendMoveHandler) {
      chartElement.removeEventListener('mousemove', trendMoveHandler);
      trendMoveHandler = null;
    }
    if (trendTempLine) {
      chart.removeSeries(trendTempLine);
      trendTempLine = null;
    }
    if (trendStartCircle) {
      trendStartCircle.remove();
      trendStartCircle = null;
    }

    trendStart = null;
    trendEnd = null;
  }
};

window.handleDeletePreviousTrendline = () => {
  if (trendLineSeries.length === 0) return;
  if (isDrawingTrendline) {
    handleToggleTrendline()
  }
  // Lấy và xóa đường trendline cuối cùng
  const lastLine = trendLineSeries.pop();
  chart.removeSeries(lastLine);
};
