import { useEffect, useRef, useState } from 'react';
import type { WebinarSetup } from '@workspace/api-client-react';
import { useGetDevelopmentStatus } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (setup: WebinarSetup, developmentSimulation?: { optIn: true; eventStatus: EventStatus }) => void;
  submitting?: boolean;
  error?: string;
}
type EventStatus = 'draft' | 'open_for_registration' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Convert a wall-clock value in an IANA timezone to the instant required by
 * the API. Launch and event values are not browser-local timestamps.
 */
function wallClockToIso(date: string, time: string, timezone: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    return null;
  }
  const wallClockUtc = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  let instant = new Date(wallClockUtc);
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(instant)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;
    const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    instant = new Date(wallClockUtc - (localAsUtc - instant.getTime()));
  }
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

export default function WebinarSetupDialog({ open, onOpenChange, onSubmit, submitting = false, error = '' }: Props) {
  const development = useGetDevelopmentStatus({ query: { queryKey: ['webinar-creation-development-status'] } });
  const [simulationOptIn, setSimulationOptIn] = useState(false);
  const [eventStatus, setEventStatus] = useState<EventStatus | ''>('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [timezone, setTimezone] = useState('');
  const [platform, setPlatform] = useState('');
  const [launchDate, setLaunchDate] = useState('');
  const [launchTime, setLaunchTime] = useState('');
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setEventDate('');
      setEventTime('');
      setDurationMinutes(60);
      setTimezone('');
      setPlatform('');
      setLaunchDate('');
      setLaunchTime('');
      setSimulationOptIn(false);
      setEventStatus('');
    }
    wasOpen.current = open;
  }, [open]);

  const launchAt = wallClockToIso(launchDate, launchTime, timezone);
  const isValid = Boolean(
    eventDate
    && eventTime
    && timezone
    && Number.isInteger(durationMinutes)
    && durationMinutes > 0
    && durationMinutes <= 1440
    && platform
    && launchAt
    && (!simulationOptIn || (development.data?.mode === 'open-development' && eventStatus)),
  );

  const handleSubmit = () => {
    if (!isValid || !launchAt) return;

    onSubmit({
      eventDate,
      eventTime,
      durationMinutes,
      timezone,
      platform,
      speakers: [],
      recruitmentLaunchAt: launchAt,
    }, simulationOptIn && eventStatus ? { optIn: true, eventStatus } : undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-4 right-4 top-[5dvh] w-auto max-w-none translate-x-0 translate-y-0 sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-full sm:max-w-[425px] sm:-translate-x-1/2 sm:-translate-y-1/2 max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Setup New Webinar</DialogTitle>
          <DialogDescription>
            Set the event details to create your webinar and its five-message communications template.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs space-y-2">
            <p className="font-semibold text-sm">Included automatically</p>
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
              <li>2 invites: 14 and 7 days before the webinar</li>
              <li>2 reminders: 24 hours and 1 hour before</li>
              <li>1 attendee thank-you: 1 day after</li>
            </ul>
            <p className="text-muted-foreground">Weekend invites move to Friday; the thank-you moves to Monday. Invites before campaign launch are skipped. Edit the copy after creation; emails are not sent automatically.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="webinar-event-date">Event Date</Label>
              <Input id="webinar-event-date" type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webinar-event-time">Event Time</Label>
              <Input id="webinar-event-time" type="time" value={eventTime} onChange={e => setEventTime(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="webinar-timezone">Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="webinar-timezone"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/New_York">America/New_York</SelectItem>
                  <SelectItem value="America/Chicago">America/Chicago</SelectItem>
                  <SelectItem value="America/Denver">America/Denver</SelectItem>
                  <SelectItem value="America/Los_Angeles">America/Los_Angeles</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="webinar-platform">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger id="webinar-platform"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Zoom">Zoom</SelectItem>
                  <SelectItem value="Teams">Teams</SelectItem>
                  <SelectItem value="Webex">Webex</SelectItem>
                  <SelectItem value="ON24">ON24</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="webinar-duration">Duration (Minutes)</Label>
            <Input id="webinar-duration" type="number" min={1} max={1440} value={durationMinutes} onChange={e => setDurationMinutes(Number(e.target.value))} />
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border mt-2">
            <div className="space-y-2">
              <Label htmlFor="webinar-launch-date">Campaign Launch Date</Label>
              <Input id="webinar-launch-date" type="date" value={launchDate} onChange={e => setLaunchDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webinar-launch-time">Campaign Launch Time</Label>
              <Input id="webinar-launch-time" type="time" value={launchTime} onChange={e => setLaunchTime(e.target.value)} />
            </div>
          </div>
          {development.data?.mode === 'open-development' && <div className="space-y-2 rounded border p-3 text-sm">
            <label className="flex items-start gap-2"><input type="checkbox" checked={simulationOptIn} onChange={e => { setSimulationOptIn(e.target.checked); setEventStatus(''); }} />
              <span>Opt this NEW synthetic occurrence into the exact webinar standard for development simulation only. This creates an immutable plan; it does not authorize sending or operational use.</span>
            </label>
            {simulationOptIn && <label className="block">Explicit event status for simulation (required)
              <select className="mt-1 w-full rounded border bg-background p-2" value={eventStatus} onChange={e => setEventStatus(e.target.value as EventStatus | '')}>
                <option value="">Choose an event status—none is assumed</option>
                <option value="draft">Draft</option><option value="open_for_registration">Open for registration</option>
                <option value="scheduled">Scheduled</option><option value="in_progress">In progress</option>
                <option value="completed">Completed</option><option value="cancelled">Cancelled</option>
              </select>
            </label>}
          </div>}
          {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!isValid || submitting} onClick={handleSubmit}>
            {submitting ? 'Saving…' : 'Create Webinar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}