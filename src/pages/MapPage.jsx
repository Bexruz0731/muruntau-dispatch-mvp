import { useEffect } from 'react';
import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';
import LoadPointMarker from '../components/scene/LoadPointMarker';
import Truck from '../components/scene/Truck';
import RouteTube from '../components/scene/RouteTube';
import { LOAD_POINTS } from '../simulation/constants';
import { useSimulationStore } from '../simulation/store';

const MOVING_PHASES = new Set(['TO_LOAD', 'EXITING']);

export default function MapPage() {
  const trucks = useSimulationStore((s) => s.trucks);
  const startSimulation = useSimulationStore((s) => s.startSimulation);
  const stopSimulation = useSimulationStore((s) => s.stopSimulation);

  useEffect(() => {
    startSimulation();
    return () => stopSimulation();
  }, [startSimulation, stopSimulation]);

  return (
    <div className="w-full h-[calc(100vh-4rem)]">
      <CareerScene>
        <PitTerrain />
        {LOAD_POINTS.map((lp) => {
          const queueCount = trucks.filter(
            (t) => t.targetLoadPointId === lp.id && (t.phase === 'TO_LOAD' || t.phase === 'LOADING'),
          ).length;
          return (
            <LoadPointMarker
              key={lp.id}
              name={lp.name}
              position={lp.position}
              color={lp.color}
              queueCount={queueCount}
            />
          );
        })}
        {trucks
          .filter((t) => MOVING_PHASES.has(t.phase))
          .map((truck) => (
            <RouteTube key={`route-${truck.id}-${truck.phase}`} path={truck.path} />
          ))}
        {trucks.map((truck) => (
          <Truck key={truck.id} truck={truck} />
        ))}
      </CareerScene>
    </div>
  );
}
