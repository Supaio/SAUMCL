const DAY_MS = 86400000;
const RADIANS = Math.PI / 180;

// NOAA's approximate solar declination and equation-of-time model:
// https://gml.noaa.gov/grad/solcalc/solareqns.PDF
// Longitudes are east-positive; all returned angles are in radians.
export const getSunPosition = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const yearDays = (Date.UTC(year + 1, 0, 1) - yearStart) / DAY_MS;
  const day = Math.floor((timestamp - yearStart) / DAY_MS) + 1;
  const minutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const gamma =
    ((2 * Math.PI) / yearDays) * (day - 1 + (minutes / 60 - 12) / 24);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const longitudeDegrees = (720 - minutes - equationOfTime) / 4;

  return {
    declination,
    longitude:
      (((((longitudeDegrees + 180) % 360) + 360) % 360) - 180) * RADIANS,
  };
};
