// Animation variants
export {
  // Fade variants
  fadeIn,
  fadeUp,
  fadeDown,
  // Scale variants
  scaleIn,
  scaleUp,
  // Slide variants
  slideInRight,
  slideInLeft,
  slideInBottom,
  // Stagger containers
  staggerContainer,
  staggerContainerFast,
  staggerContainerSlow,
  // Card hover variants
  cardHover,
  cardHoverSubtle,
  cardHoverGlow,
  // Button variants
  buttonPress,
  buttonPressSubtle,
  // List variants
  listItem,
  // Page transition variants
  pageTransition,
  // Modal variants
  modalOverlay,
  modalContent,
  // Slide panel variants
  slidePanelRight,
  slidePanelLeft,
  // Loading variants
  shimmer,
  pulse,
  // Float variants
  float,
  floatSlow,
  // Icon variants
  iconSpin,
  iconPulse,
  iconBounce,
  // Presets
  springPresets,
  durationPresets
} from './variants';

// Animation hooks
export {
  useAnimationProps,
  useFadeUpAnimation,
  useScaleInAnimation,
  useHoverAnimation,
  useStaggerDelay,
  useStaggeredItemAnimation,
  useViewportAnimation,
  useSpringTransition,
  useEntranceAnimation,
  useAnimationsEnabled,
  useContainerAnimation,
  useChildAnimation
} from './hooks';
