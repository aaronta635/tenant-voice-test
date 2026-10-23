type Props = { date: string; day: number; today: boolean; booked: boolean; enquiry: boolean };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * One day on the overview calendar. Today keeps its outline whatever else the day holds.
 * The weekday and the day's bookings are read out as text: a plain span has no role
 * that can carry an aria-label, so screen readers skip one.
 */
export default function CalendarDay({ date, day, today, booked, enquiry }: Props) {
  const todayRing = today ? ' ring-2 ring-text-dark ring-offset-2' : '';
  const style = booked
    ? `border-primary-strong bg-primary-strong text-white${todayRing}`
    : enquiry
      ? `border-warning border-dashed text-warning${todayRing}`
      : today
        ? 'border-text-dark ring-2 ring-text-dark font-extrabold text-text-dark'
        : 'border-transparent text-[#5f6b76]';
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const states = [today && 'today', booked && 'confirmed booking', enquiry && 'unaccepted enquiry'].filter(Boolean);
  return (
    <span
      data-calendar-booked={booked || undefined}
      data-calendar-enquiry={enquiry || undefined}
      title={`${date}${today ? ' · Today' : ''}${booked ? ' · Confirmed booking' : ''}${enquiry ? ' · Unaccepted enquiry' : ''}`}
      aria-current={today ? 'date' : undefined}
      className={`flex h-10 items-center justify-center rounded-full border text-xs font-semibold ${style}`}
    >
      <span className="sr-only">{weekday} </span>
      {day}
      {states.length ? <span className="sr-only">, {states.join(', ')}</span> : null}
    </span>
  );
}
