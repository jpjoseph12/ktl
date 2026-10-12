import { useKettle } from '../context/KettleContext';
import { CLASSES, LABELS } from '../lib/kettle';

export default function Pill({ item }) {
  const { statusOf } = useKettle();
  const s = statusOf(item);
  return <span className={'pill ' + CLASSES[s]}>{LABELS[s]}</span>;
}
