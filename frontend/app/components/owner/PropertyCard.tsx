import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import { BedIcon, BathIcon, CarIcon } from '@/app/components/owner/icons';
import type { Property } from '@/app/lib/api';

const STATUS_LABEL: Record<Property['status'], string> = {
  available: 'Available',
  rented: 'Rented',
  off_market: 'Off-market',
};

const STATUS_CLASSES: Record<Property['status'], string> = {
  available: 'bg-success/10 text-success',
  rented: 'bg-primary/10 text-primary',
  off_market: 'bg-[#f3f4f6] text-text-body',
};

export default function PropertyCard({ property }: { property: Property }) {
  const photo = property.photo_urls?.[0];

  return (
    <Card className="overflow-hidden p-0">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="h-[180px] w-full object-cover" />
      ) : (
        <div className="flex h-[180px] items-center justify-center bg-[#f3f4f6] text-text-subtle">
          <span className="text-sm">No photo yet</span>
        </div>
      )}
      <div className="p-6">
        <p className="font-heading text-lg font-semibold text-text-dark">{property.title}</p>
        <p className="mt-1 text-sm text-text-body">{property.address}</p>
        <p className="mt-3 text-xl font-bold text-primary">
          ${property.price.toLocaleString()}/week
        </p>
        <span
          className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASSES[property.status]}`}
        >
          {STATUS_LABEL[property.status]}
        </span>
        <div className="mt-4 flex items-center gap-4 text-sm text-text-body">
          <span className="flex items-center gap-1.5">
            <BedIcon size={16} /> {property.bedrooms ?? 0} Bed
          </span>
          <span className="flex items-center gap-1.5">
            <BathIcon size={16} /> {property.bathrooms ?? 0} Bath
          </span>
          <span className="flex items-center gap-1.5">
            <CarIcon size={16} /> {property.parking ?? 0} Car
          </span>
        </div>
        <div className="mt-5 flex gap-3 border-t border-border pt-4">
          <Link href={`/owner/properties/${property.id}`} className="flex-1">
            <Button variant="primary" fullWidth>
              View
            </Button>
          </Link>
          <Link href={`/owner/properties/${property.id}`} className="flex-1">
            <Button variant="secondary" fullWidth>
              Manage
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
