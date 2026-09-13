import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useCreateCampaign } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import { useToast } from '@/hooks/use-toast';

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  scope: z.enum(['Global', 'Regional', 'Decide later', 'Not applicable']),
  audience: z.string().min(1, 'Audience is required'),
  outcome: z.string().min(1, 'Outcome is required'),
});

type CreateForm = z.infer<typeof createSchema>;

export default function CampaignCreate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createMutation = useCreateCampaign();

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: '',
      scope: 'Global',
      audience: '',
      outcome: '',
    },
  });

  const onSubmit = (data: CreateForm) => {
    createMutation.mutate({ data }, {
      onSuccess: (res) => {
        toast({ title: 'Campaign created successfully' });
        setLocation(`/campaigns/${res.id}`);
      },
      onError: () => {
        toast({ title: 'Failed to create campaign', variant: 'destructive' });
      }
    });
  };

  return (
    <div className="flex-1 overflow-auto bg-muted/20">
      <div className="max-w-2xl mx-auto p-6 md:p-10 space-y-6">
        <Link href="/campaigns" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to campaigns
        </Link>

        <Card className="shadow-lg border-border">
          <CardHeader>
            <CardTitle className="text-2xl">New Campaign</CardTitle>
            <CardDescription>Four simple questions to initialize your strategy.</CardDescription>
          </CardHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>1. What is the working name?</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Q4 Cloud Launch" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="scope"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>2. What is the regional scope?</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select scope" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Global">Global</SelectItem>
                          <SelectItem value="Regional">Regional</SelectItem>
                          <SelectItem value="Decide later">Decide later</SelectItem>
                          <SelectItem value="Not applicable">Not applicable</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="audience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>3. Who is the primary audience?</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Enterprise IT Leaders" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="outcome"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>4. What is the primary outcome?</FormLabel>
                      <FormControl>
                        <Textarea placeholder="e.g. Drive 500 MQLs for the new cloud security product." className="resize-none" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter className="bg-muted/30 py-4 border-t border-border flex justify-end">
                <Button type="submit" disabled={createMutation.isPending} size="lg">
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create Campaign
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      </div>
    </div>
  );
}
