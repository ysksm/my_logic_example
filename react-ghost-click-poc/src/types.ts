export interface Part {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface Point {
  x: number;
  y: number;
}

export const INITIAL_PARTS: Part[] = [
  { id: "a", name: "A", x: 30, y: 40, w: 120, h: 80, color: "#4f86c6" },
  { id: "b", name: "B", x: 200, y: 60, w: 120, h: 80, color: "#5aa469" },
  { id: "c", name: "C", x: 100, y: 180, w: 160, h: 80, color: "#d98c3e" },
];
