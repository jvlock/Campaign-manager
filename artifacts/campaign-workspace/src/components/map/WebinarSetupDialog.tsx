import { useEffect, useRef, useState } from 'react';
import type { WebinarSetup } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (setup: WebinarSetup) => void;
  submitting?: boolean;
  error?: string;
}

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
    && launchAt,
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
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Setup New Webinar</DialogTitle>
          <DialogDescription>
            Provide the required dates and configuration. These cannot be random defaults.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Event Date</Label>
              <Input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Event Time</Label>
              <Input type="time" value={eventTime} onChange={e => setEventTime(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
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
              <Label>Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
            <Label>Duration (Minutes)</Label>
            <Input type="number" min={1} max={1440} value={durationMinutes} onChange={e => setDurationMinutes(Number(e.target.value))} />
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border mt-2">
            <div className="space-y-2">
              <Label>Campaign Launch Date</Label>
              <Input type="date" value={launchDate} onChange={e => setLaunchDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Campaign Launch Time</Label>
              <Input type="time" value={launchTime} onChange={e => setLaunchTime(e.target.value)} />
            </div>
          </div>
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