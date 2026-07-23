/** Stat chip for ride posts (distance, climbing, time — plus one joke slot max). */
export interface StatChipProps {
  /** The number, pre-formatted ("102", "6,400", "6:48"). */
  value: string;
  /** Unit after the value ("mi", "ft", "hrs", "🌯"). */
  unit?: string;
  /** All-caps mono label ("DISTANCE"). */
  label: string;
}
