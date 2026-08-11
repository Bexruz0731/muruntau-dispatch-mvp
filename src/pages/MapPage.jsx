import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';

export default function MapPage() {
  return (
    <div className="w-full h-[calc(100vh-4rem)]">
      <CareerScene>
        <PitTerrain />
      </CareerScene>
    </div>
  );
}
