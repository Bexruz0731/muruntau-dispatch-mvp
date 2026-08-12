import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';
import LoadPointMarker from '../components/scene/LoadPointMarker';
import Belt from '../components/scene/Belt';
import Truck from '../components/scene/Truck';
import RouteTube from '../components/scene/RouteTube';
import DispatcherPanel from '../components/DispatcherPanel';
import { LOAD_POINTS } from '../simulation/constants';
import { useSimulationStore, getQueueCounts, getBeltQueueCount } from '../simulation/store';

const MOVING_PHASES = new Set(['TO_LOAD', 'EXITING', 'RETURNING']);

export default function MapPage() {
  const trucks = useSimulationStore((s) => s.trucks);
  const events = useSimulationStore((s) => s.events);
  const mode = useSimulationStore((s) => s.mode);
  const setMode = useSimulationStore((s) => s.setMode);

  const queueCounts = getQueueCounts(trucks);
  const loadPointsWithQueue = LOAD_POINTS.map((lp) => ({ ...lp, queueCount: queueCounts[lp.id] || 0 }));
  const beltQueueCount = getBeltQueueCount(trucks);

  return (
    <div className="w-full h-[calc(100vh-4rem)] flex">
      <div className="flex-1 min-w-0">
        <CareerScene>
          <PitTerrain />
          <Belt queueCount={beltQueueCount} />
          {loadPointsWithQueue.map((lp) => (
            <LoadPointMarker
              key={lp.id}
              name={lp.name}
              position={lp.position}
              color={lp.color}
              queueCount={lp.queueCount}
            />
          ))}
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
      <DispatcherPanel
        trucks={trucks}
        loadPoints={loadPointsWithQueue}
        beltQueueCount={beltQueueCount}
        events={events}
        mode={mode}
        onModeChange={setMode}
      />
    </div>
  );
}
