// The lf. mark — the vector source of truth for every brand asset in public/.
// The letterforms were outlined from Fira Code 700 at design time and committed
// here, so generation never shapes text and needs no font on disk (ADR 0032).
//
// Outline coordinates are font units, y-up; `transform` flips the y-axis and
// scales them into the mark's 64-unit square.

export const mark = {
	size: 64,
	label: 'lf. — lukefredrickson.dev',
	transform: 'matrix(0.024597,0,0,-0.024597,1.401,50.239)',
	outlines: [
		{
			name: 'ltr',
			d: 'M694.0 1484.0V334.0Q694.0 270.0 730.5 242.5Q767.0 215.0 831.0 215.0Q872.0 215.0 910.0 224.5Q948.0 234.0 981.0 247.0L1057.0 36.0Q1003.0 8.0 927.0 -13.0Q851.0 -34.0 750.0 -34.0Q558.0 -34.0 468.0 76.5Q378.0 187.0 378.0 373.0V1268.0H65.0V1484.0ZM1836.0 1517.0Q1952.0 1517.0 2041.0 1498.5Q2130.0 1480.0 2200.0 1450.0L2113.0 1244.0Q2058.0 1265.0 2000.0 1274.5Q1942.0 1284.0 1885.0 1284.0Q1791.0 1284.0 1750.5 1250.0Q1710.0 1216.0 1710.0 1137.0V995.0H2056.0L2021.0 776.0H1710.0V0.0H1396.0V776.0H1173.0V995.0H1396.0V1149.0Q1396.0 1254.0 1446.0 1337.0Q1496.0 1420.0 1594.0 1468.5Q1692.0 1517.0 1836.0 1517.0Z',
		},
		{
			name: 'dot',
			d: 'M1977.0 189.0Q1977.0 250.0 2007.0 300.5Q2037.0 351.0 2088.0 381.5Q2139.0 412.0 2200.0 412.0Q2262.0 412.0 2312.5 381.5Q2363.0 351.0 2393.0 300.5Q2423.0 250.0 2423.0 189.0Q2423.0 129.0 2393.0 78.0Q2363.0 27.0 2312.5 -3.5Q2262.0 -34.0 2200.0 -34.0Q2139.0 -34.0 2088.0 -3.5Q2037.0 27.0 2007.0 78.0Q1977.0 129.0 1977.0 189.0Z',
		},
	],
}

// Ink per outline, keyed by the outline names above.
export const palette = {
	light: { ltr: '#55516f', dot: '#e1a035' },
	dark: { ltr: '#dddceb', dot: '#ffc05a' },
}
