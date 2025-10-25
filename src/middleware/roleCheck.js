export const roleCheck = (allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.headers['x-user-role'];
    
    console.log('User role:', userRole);
    console.log('Allowed roles:', allowedRoles);
    console.log('Is allowed?', allowedRoles.includes(userRole));
    
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};
// export const roleCheck = (allowedRoles) => {
//   return (req, res, next) => {
//     const userRole = req.headers['x-user-role'];
    
//     if (!userRole) {
//       return res.status(401).json({ error: 'User role not provided' });
//     }

//     if (!allowedRoles.includes(userRole)) {
//       return res.status(403).json({ 
//         error: 'Insufficient permissions',
//         required: allowedRoles,
//         provided: userRole
//       });
//     }

//     next();
//   };
// };