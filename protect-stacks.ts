import * as pulumi from '@pulumi/pulumi'

const PROTECTED_STACKS = ['staging', 'prod']

export const protectStacksIfNeeded = () => {
  const stack = pulumi.getStack()
  if (!PROTECTED_STACKS.includes(stack)) return

  pulumi.runtime.registerStackTransformation((args) => ({
    props: args.props,
    opts: pulumi.mergeOptions(args.opts, { protect: true }),
  }))
}
