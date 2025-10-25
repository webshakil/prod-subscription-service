export const validateSubscriptionPlan = (req, res, next) => {
  const { name, price, duration, type, max_elections, max_voters_per_election } = req.body;

  const errors = [];

  if (!name || typeof name !== 'string') errors.push('Valid plan name required');
  if (!price || typeof price !== 'number' || price <= 0) errors.push('Valid price required');
  if (!duration || !['monthly', '3months', '6months', 'yearly', 'paygo'].includes(duration)) {
    errors.push('Valid duration required');
  }
  if (!type || !['individual', 'organization'].includes(type)) {
    errors.push('Valid type required');
  }
  if (typeof max_elections !== 'number') errors.push('Valid max_elections required');
  if (typeof max_voters_per_election !== 'number') errors.push('Valid max_voters_per_election required');

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  next();
};

export const validatePaymentData = (req, res, next) => {
  const { amount, currency, country_code, payment_method, planId } = req.body;

  const errors = [];

  if (!amount || typeof amount !== 'number' || amount <= 0) errors.push('Valid amount required');
  if (!currency || typeof currency !== 'string') errors.push('Valid currency required');
  if (!country_code || typeof country_code !== 'string') errors.push('Valid country_code required');
  if (!planId) errors.push('Plan ID required');
  if (payment_method && !['card', 'paypal', 'google_pay', 'apple_pay'].includes(payment_method)) {
    errors.push('Invalid payment method');
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  next();
};

export const validateGatewayConfig = (req, res, next) => {
  const { gateway_type, stripe_enabled, paddle_enabled, recommendation_reason } = req.body;
  const { regionId } = req.params;

  const errors = [];

  if (!regionId) errors.push('Region required');
  if (!gateway_type) errors.push('Gateway type required');
  if (typeof stripe_enabled !== 'boolean') errors.push('stripe_enabled must be boolean');
  if (typeof paddle_enabled !== 'boolean') errors.push('paddle_enabled must be boolean');
  // if (!recommendation_reason || typeof recommendation_reason !== 'string') {
  //   errors.push('Recommendation reason required');
  // }
  if (recommendation_reason && typeof recommendation_reason !== 'string') {
  errors.push('Recommendation reason must be string');
}

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  next();
};
// export const validateSubscriptionPlan = (req, res, next) => {
//   const { name, price, duration, type, max_elections, max_voters_per_election } = req.body;

//   const errors = [];

//   if (!name || typeof name !== 'string') errors.push('Valid plan name required');
//   if (!price || typeof price !== 'number' || price <= 0) errors.push('Valid price required');
//   if (!duration || !['monthly', '3months', '6months', 'yearly', 'paygo'].includes(duration)) {
//     errors.push('Valid duration required');
//   }
//   if (!type || !['individual', 'organization'].includes(type)) {
//     errors.push('Valid type required');
//   }
//   if (typeof max_elections !== 'number') errors.push('Valid max_elections required');
//   if (typeof max_voters_per_election !== 'number') errors.push('Valid max_voters_per_election required');

//   if (errors.length > 0) {
//     return res.status(400).json({ errors });
//   }

//   next();
// };

// export const validatePaymentData = (req, res, next) => {
//   const { amount, currency, country_code, payment_method, planId } = req.body;

//   const errors = [];

//   if (!amount || typeof amount !== 'number' || amount <= 0) errors.push('Valid amount required');
//   if (!currency || typeof currency !== 'string') errors.push('Valid currency required');
//   if (!country_code || typeof country_code !== 'string') errors.push('Valid country_code required');
//   if (!planId) errors.push('Plan ID required');
//   if (payment_method && !['card', 'paypal', 'google_pay', 'apple_pay'].includes(payment_method)) {
//     errors.push('Invalid payment method');
//   }

//   if (errors.length > 0) {
//     return res.status(400).json({ errors });
//   }

//   next();
// };









// export const validateGatewayConfig = (req, res, next) => {
//   const { region, gateway_type, stripe_enabled, paddle_enabled, recommendation_reason } = req.body;

//   const errors = [];

//   if (!region) errors.push('Region required');
//   if (!gateway_type) errors.push('Gateway type required');
//   if (typeof stripe_enabled !== 'boolean') errors.push('stripe_enabled must be boolean');
//   if (typeof paddle_enabled !== 'boolean') errors.push('paddle_enabled must be boolean');
//   if (!recommendation_reason || typeof recommendation_reason !== 'string') {
//     errors.push('Recommendation reason required');
//   }

//   if (errors.length > 0) {
//     return res.status(400).json({ errors });
//   }

//   next();
// };