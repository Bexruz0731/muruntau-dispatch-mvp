import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';
import LoadPointMarker from '../components/scene/LoadPointMarker';
import Truck from '../components/scene/Truck';
import { LOAD_POINTS } from '../simulation/constants';

// Статичный список машин только для этапа 1 (визуальная демонстрация каркаса).
// TODO: заменить на реальные данные трекеров в проде — в этапе 2 этот список
// станет производным от живого симулятора (Zustand store), а не хардкодом.
const DEMO_TRUCKS = [
  { id: 1, number: '07', position: [1, 27] },
  { id: 2, number: '12', position: [23.5, 0] },
  { id: 3, number: '19', position: [9.6, 16.6] },
  { id: 4, number: '23', position: [-7.4, 12.8] },
  { id: 5, number: '31', position: [-16, 8] },
  { id: 6, number: '34', position: [16, -6] },
  { id: 7, number: '41', position: [-10.5, 0] },
  { id: 8, number: '45', position: [7.4, -12.8] },
];

export default function MapPage() {
  return (
    <div className="w-full h-[calc(100vh-4rem)]">
      <CareerScene>
        <PitTerrain />
        {LOAD_POINTS.map((lp) => (
          <LoadPointMarker key={lp.id} name={lp.name} position={lp.position} color={lp.color} />
        ))}
        {DEMO_TRUCKS.map((truck) => (
          <Truck key={truck.id} number={truck.number} position={truck.position} />
        ))}
      </CareerScene>
    </div>
  );
}
