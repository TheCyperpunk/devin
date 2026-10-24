// Names, colours and event wording for the big screen. The scenario comes from the shared package so the screen
// never asks the hub for node positions.
import { thuruthu, type BoatColor, type GameEvent, type GameView, type Kit, type NeedType, type ScenarioNode } from '@pralayam/shared';

export const NODES: Record<string, ScenarioNode> = Object.fromEntries(thuruthu.nodes.map((n) => [n.id, n]));
export const nodeName = (id: string | undefined) => (id && NODES[id]?.name) || '?';

export const COLOR_HEX: Record<BoatColor, string> = {
  moss: '#2EC4B6',
  ember: '#FF6B35',
  lamp: '#FFB74D',
  water: '#2FA8C4',
  rose: '#FF5C8A',
  lilac: '#B388FF',
  sand: '#E8C39E',
  sky: '#7CC7FF',
};

export const NEED_WORD: Record<NeedType, string> = { food: 'food', water: 'water', medical: 'medical', rescue: 'rescue', shelter: 'shelter' };
export const KIT_WORD: Record<Kit, string> = { water: 'water kit', food: 'food kit', medical: 'medical kit' };

export function boatName(view: GameView | null, id: string | undefined): string {
  return view?.boats.find((b) => b.id === id)?.name ?? 'A boat';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : name.slice(0, 2)).toUpperCase();
}

export interface Toast {
  id: number;
  text: string;
  points: number;
  tone: 'good' | 'bad' | 'info';
  at: number;
}

/** Events worth a line on the screen, in plain words. Movement and refills stay silent. */
export function toastFor(e: GameEvent, view: GameView | null): Omit<Toast, 'id' | 'at'> | null {
  const who = boatName(view, e.boatId);
  const where = nodeName(e.nodeId);
  const n = e.count ?? 0;
  switch (e.type) {
    case 'rescued':
      return { text: `${who} took ${n} aboard at ${where}`, points: 0, tone: 'good' };
    case 'saved':
      return { text: `${who} brought ${n} to safety at ${where}`, points: e.points, tone: 'good' };
    case 'priority_saved':
      return { text: `${n} ${n === 1 ? 'child or elder' : 'children and elders'} first`, points: e.points, tone: 'good' };
    case 'hospital_bonus':
      return { text: `${n} reached the hospital in time`, points: e.points, tone: 'good' };
    case 'kit_matched':
      return { text: `${who} dropped the right kit at ${where}`, points: e.points, tone: 'good' };
    case 'kit_wasted':
      return { text: `${who} dropped a kit nobody needed at ${where}`, points: e.points, tone: 'bad' };
    case 'lost':
      return { text: `${n} lost to the water at ${where}`, points: e.points, tone: 'bad' };
    case 'flooded':
      return { text: `Water reached ${where}: ${n} on the roof`, points: 0, tone: 'bad' };
    case 'call_opened':
      return { text: `Call from ${where}: ${n} ${n === 1 ? 'person' : 'people'}`, points: 0, tone: 'info' };
    case 'water_rose':
      return { text: `The water is rising`, points: 0, tone: 'bad' };
    case 'saved_late':
      return { text: `${who}: ${n} still aboard at first light`, points: e.points, tone: 'info' };
    case 'invalid':
      return { text: `${who}: that order could not be carried out`, points: 0, tone: 'info' };
    case 'standing_used':
      return view?.boats.find((b) => b.id === e.boatId)?.bot ? null : { text: `${who} is out of contact: standing order`, points: 0, tone: 'info' };
    default:
      return null;
  }
}

export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Totals for the bars and the end screen, derived from the view only. */
export function totals(view: GameView) {
  const events = view.history.flatMap((h) => h.events);
  const sum = (type: GameEvent['type']) => events.filter((e) => e.type === type).reduce((n, e) => n + (e.count ?? 0), 0);
  const saved = view.boats.reduce((n, b) => n + b.saved, 0);
  const people = view.calls.reduce((n, c) => n + c.peopleCount, 0);
  const waiting = view.calls.filter((c) => c.status === 'open').reduce((n, c) => n + c.remaining, 0);
  const aboard = view.boats.reduce((n, b) => n + b.passengers.length, 0);
  return {
    saved,
    people,
    waiting,
    aboard,
    lost: sum('lost'),
    priority: sum('priority_saved'),
    outOfContactRounds: events.filter((e) => e.type === 'standing_used').length,
  };
}

/** Which pixel icon stands for each kit. */
export const KIT_WORD_SPRITE: Record<Kit, 'kitWater' | 'kitFood' | 'kitMed'> = { water: 'kitWater', food: 'kitFood', medical: 'kitMed' };
