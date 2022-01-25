import * as React from "react"
import { graphql, Link } from "gatsby"
import Layout from "../../components/layout.js"

function BlogPost({ data }) {
    const post = data.markdownRemark.frontmatter

    return (
        <Layout>
            <div className="wrapper">
                <header>
                    <Link to="/">Go back to "Home"</Link>
                </header>
                <main>
                    <h1>{post.title}</h1>
                    <p>{post.description}</p>
                    <em>{post.date}</em>}
                    <div dangerouslySetInnerHTML={{ __html: data.markdownRemark.html }} />
                </main>
            </div>
        </Layout>
    )
}

export default BlogPost

export const query = graphql`
  query($id: String!) {
    markdownRemark(id: { eq: $id }) {
      frontmatter {
        date(formatString: "MM-DD-YYYY")
        description
        title
      }
      html
    }
  }
`