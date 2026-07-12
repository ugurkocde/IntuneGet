export interface FAQ {
  question: string;
  answer: string;
  category?: "getting-started" | "security" | "deployment" | "self-hosting";
  visibleOnPage?: boolean;
  linkHref?: string;
  linkLabel?: string;
}

export const faqData: FAQ[] = [
  {
    question: "Where is my data stored?",
    category: "security",
    answer:
      "On the hosted version (intuneget.com), data is stored in the European Union, in Supabase's Frankfurt, Germany region (eu-central-1). We only keep the operational metadata needed to run the service, such as your account email, deployment history, app catalog, and team settings. We never store your app installers or your Intune credentials: authentication uses Microsoft Entra ID, access tokens stay in your browser, and packaged apps are uploaded directly to your own Intune tenant. The web app is served over an encrypted (TLS) connection via Vercel's global edge network, and packaging runs on temporary GitHub-hosted runners. If you need data to stay entirely on your own infrastructure or in a specific region, IntuneGet is open source and can be self-hosted with an embedded SQLite database.",
  },
  {
    question: "What permissions does IntuneGet request?",
    category: "security",
    answer:
      "IntuneGet uses a single delegated permission, User.Read, to sign you in and read your basic profile - nothing else runs under your user identity. The app itself uses five application permissions that a Global Administrator grants once through admin consent. Two of them allow writes: DeviceManagementApps.ReadWrite.All to create and update the apps IntuneGet uploads to your tenant, and DeviceManagementServiceConfig.ReadWrite.All for Intune service configuration used during app setup. The other three are read-only, covering device configuration, managed device information, and group membership.",
    linkHref: "/security",
    linkLabel: "See the full permissions list",
  },
  {
    question: "What can IntuneGet see and do in my tenant?",
    category: "security",
    answer:
      "IntuneGet can create and update the apps it deploys to your Intune tenant, read group membership so you can pick assignment groups, and read device and configuration data for deployment context and reporting. It cannot read your mail, your files, or any user data beyond the basic profile used for sign-in. Access tokens stay in your browser, and your app installers and Intune credentials are never stored.",
    linkHref: "/security",
    linkLabel: "Read the security overview",
  },
  {
    question: "What happens if IntuneGet is discontinued?",
    category: "self-hosting",
    answer:
      "Nothing breaks. Every app you deploy lives in your own Intune tenant, so your deployments keep working regardless of what happens to IntuneGet. The project is open source under the AGPL-3.0 license and fully self-hostable with Docker and an embedded SQLite database, so you can run your own instance for as long as you like. There is no vendor lock-in.",
  },
  {
    question: "What is IntuneGet and how does it work?",
    category: "getting-started",
    answer:
      "IntuneGet is a free, open-source tool for deploying Winget applications to Microsoft Intune. It automatically packages applications from the full Winget catalog and uploads them to your Intune environment, streamlining your app deployment process with just a few clicks. No scripting or IntuneWin packaging required.",
  },
  {
    question: "Is IntuneGet really free, and why?",
    category: "getting-started",
    answer:
      "Yes. IntuneGet is completely free and open source under the AGPL-3.0 license - no hidden fees, no premium tiers, no seat limits, and no credit card required. It is free because we believe every IT team deserves access to great deployment tools. Since the code is open, you can audit it, modify it to fit your needs, and self-host it on your own infrastructure. No vendor lock-in, no surprise bills.",
  },
  {
    question: "How long does setup take?",
    category: "getting-started",
    answer:
      "Most users are up and running in about 5 minutes. Sign in with your Microsoft account, have a Global Administrator grant the one-time admin consent, and you're ready to start deploying apps. Our step-by-step onboarding guides you through the entire process.",
  },
  {
    question: "Which applications are supported?",
    category: "deployment",
    answer:
      "IntuneGet supports the full Winget catalog - thousands of applications including popular browsers, productivity tools, development environments, and enterprise software. The catalog is constantly growing as new apps are added to Winget.",
  },
  {
    question: "Can I self-host IntuneGet?",
    category: "self-hosting",
    answer:
      "Yes! IntuneGet is fully open source under the AGPL-3.0 license and can be self-hosted on your own infrastructure using Docker. It uses an embedded SQLite database with zero external dependencies. Check out our documentation for detailed setup instructions, or use our hosted service for a hassle-free experience.",
  },
  {
    question: "What support is available?",
    category: "getting-started",
    answer:
      "As an open source project, support is provided through our GitHub community. You can file issues and get help from other users. We also have comprehensive documentation covering common use cases and troubleshooting.",
  },
  {
    question: "How do I deploy Winget apps to Intune without scripting?",
    category: "deployment",
    answer:
      "IntuneGet eliminates the need for scripting entirely. Simply search for an app in the Winget catalog, configure your deployment settings with a visual interface, and click deploy. IntuneGet handles all the packaging, IntuneWin conversion, and upload to your Intune tenant automatically.",
  },
  {
    question: "Do I need special permissions to use IntuneGet?",
    answer:
      "Setup follows a two-step model. First, a Global Administrator grants a one-time, tenant-wide admin consent to the application permissions IntuneGet needs. After that, team members sign in with their normal Microsoft work account - we recommend an Intune Administrator or equivalently permissioned account for managing deployments.",
    visibleOnPage: false,
  },
  {
    question: "Can I assign the Owner role to a team member?",
    answer:
      "The Owner role is held by the person who creates the MSP organization and cannot be reassigned or granted to other members, which protects the organization from an accidental takeover. When you invite or edit members, the highest role you can assign is Admin. An Admin has every permission except changing member roles and deleting the organization, which remain exclusive to the Owner. This is the same in the hosted and self-hosted versions; there is no separate step or upgrade required to unlock Owner. If ownership of an organization needs to change, contact support.",
    visibleOnPage: false,
  },
  {
    question: "What is the best free tool to deploy apps to Intune?",
    answer:
      "IntuneGet is a free, open-source tool for deploying apps to Microsoft Intune. It covers the full Winget catalog, requires no scripting or manual IntuneWin packaging, and takes about 5 minutes to set up. It is free and open source under the AGPL-3.0 license with no hidden fees or seat limits.",
    visibleOnPage: false,
  },
  {
    question: "What is the best free tool for Intune app deployment?",
    answer:
      "IntuneGet is a free, open-source tool for Intune app deployment. It covers the full Winget catalog, supports self-hosting with Docker and SQLite, has no vendor lock-in, and takes about 5 minutes to set up.",
    visibleOnPage: false,
  },
  {
    question: "Can I automate Intune app deployment for free?",
    answer:
      "Yes. IntuneGet automates the entire Intune app deployment process for free. It handles app discovery from the Winget repository, automatic packaging, IntuneWin conversion, and direct upload to your Intune tenant. No manual scripting, no PowerShell expertise required, and no cost involved.",
    visibleOnPage: false,
  },
  {
    question: "Is there a free open-source Intune app deployment tool?",
    answer:
      "Yes, IntuneGet is a free, open-source Intune app deployment tool licensed under AGPL-3.0. It deploys applications from the full Winget catalog to Microsoft Intune with no cost, no seat limits, and full self-hosting support. The source code is available on GitHub and actively maintained.",
    visibleOnPage: false,
  },
  {
    question: "How to deploy apps to Intune without IntuneWin packaging?",
    answer:
      "IntuneGet handles IntuneWin packaging automatically behind the scenes. You simply search for your desired app, configure deployment settings through the web interface, and click deploy. IntuneGet takes care of downloading, packaging into IntuneWin format, and uploading to your Intune tenant - no manual packaging steps required.",
    visibleOnPage: false,
  },
  {
    question: "What tools do IT admins use to deploy apps to Intune?",
    answer:
      "IT admins commonly use several approaches to deploy apps to Intune: dedicated deployment tools like IntuneGet (free, open source, covering the full Winget catalog), commercial solutions, or manual PowerShell scripting. IntuneGet is a free, open-source option that automates packaging and upload with no scripting required.",
    visibleOnPage: false,
  },
];
