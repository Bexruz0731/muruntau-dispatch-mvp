import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';
import LoadPointMarker from '../components/scene/LoadPointMarker';
import { LOAD_POINTS } from '../simulation/constants';

export default function MapPage() {
  return (
    <div className="w-full h-[calc(100vh-4rem)]">
      <CareerScene>
        <PitTerrain />
        {LOAD_POINTS.map((lp) => (
          <LoadPointMarker key={lp.id} name={lp.name} position={lp.position} color={lp.color} />
        ))}
      </CareerScene>
    </div>
  );
}
